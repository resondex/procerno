import { store } from "../store";
import { matchKey } from "../brand_key";
import { withCostContext } from "../cost_log";
import type { Project, ResponseRow } from "../types";
import { runBrandDiscovery, runOpenDiscovery, type DiscoveryAnswer } from "./discovery";
import { consolidateTaxonomy } from "./consolidate";
import { classifyNonBrands } from "./suggest";
import { getDictionarySuggestions } from "./dict_suggest";

/**
 * The init bootstrap: everything a FIRST run owes between its last collected
 * answer and the user being told collection is done. The run stays "running"
 * throughout - status flips to "collected" (the codebook gate) only when all
 * of it is finished, so the user never lands on an empty proposal:
 *
 *   1. open discovery       - grok open-codes every answer (resumable per
 *   2. brand discovery        answer via responses.discovery_*)
 *   3. consolidation        - embeddings-first -> taxonomy proposal
 *   4. brand observations   - aggregate the brands pass, queue emerged names,
 *                             junk-filter, pre-warm dictionary suggestions
 *
 * Runs only while the project's taxonomy is unratified; scheduled runs on a
 * ratified taxonomy take the coding wave + finalize path instead. Every stage
 * is idempotent, so a killed chunk resumes instead of re-spending.
 */
export async function bootstrapRunChunk(
  runId: string,
  project: Project,
  deadline: number
): Promise<"continue" | "gated"> {
  // Operational hold, same contract as coding: with RUN_COLLECT_ONLY set the
  // run parks at "collected" and never spends a discovery cent. Clear the
  // env and hit /continue to bootstrap a held run.
  if (process.env.RUN_COLLECT_ONLY) {
    await store.updateRunStatus(
      runId,
      "collected",
      "collect-only hold (RUN_COLLECT_ONLY): discovery + codebook deferred"
    );
    return "gated";
  }

  const responses = await store.listResponses(runId);
  const promptText = new Map(
    (await store.listPrompts(project.id)).map((p) => [p.id, p.text])
  );
  const toAnswer = (r: ResponseRow): DiscoveryAnswer => ({
    id: r.id,
    engine: r.model,
    prompt: promptText.get(r.prompt_id) ?? "",
    text: r.text,
  });

  // Stages 1+2: per-answer discovery, persisted as each answer lands. A few
  // answers can fail both attempts and stay null - within a 2% tolerance
  // they are left behind rather than retried (and re-billed) forever.
  const tolerance = Math.ceil(responses.length * 0.02);
  const needCodes = responses.filter((r) => r.discovery_codes === null);
  const needBrands = responses.filter((r) => r.discovery_brands === null);
  if (needCodes.length > tolerance || needBrands.length > tolerance) {
    if (needCodes.length > tolerance) {
      await runOpenDiscovery(needCodes.map(toAnswer), {
        concurrency: 16,
        deadlineMs: deadline,
        onResult: (row) =>
          store.writeResponseDiscovery(row.responseId, { codes: row.reasons_open }),
      });
    }
    if (needBrands.length > tolerance && Date.now() < deadline) {
      await withCostContext({ purpose: "discovery:brands" }, () =>
        runBrandDiscovery(needBrands.map(toAnswer), {
          concurrency: 16,
          deadlineMs: deadline,
          onResult: (row) =>
            store.writeResponseDiscovery(row.responseId, { brands: row.brands }),
        })
      );
    }
    // Whatever happened, the consolidation stage gets a fresh invocation of
    // its own - its single Opus call needs the whole function budget, not a
    // chunk's leftovers.
    return "continue";
  }
  const fresh = responses;

  // Stage 3: consolidation -> proposal. One shot per project; a re-drive
  // after the proposal exists skips straight past.
  if ((project.taxonomy_status ?? "pending") === "pending") {
    const proposal = await consolidateTaxonomy(
      project.brand,
      fresh
        .filter((r) => r.discovery_codes !== null)
        .map((r) => ({
          responseId: r.id,
          phrases: JSON.parse(r.discovery_codes!) as string[],
        }))
    );
    await store.setTaxonomyProposal(project.id, JSON.stringify(proposal));
  }

  // Stage 4: brand observations + the dictionary queue.
  if (!project.brand_observations) {
    const dict = await store.getDictionary(project.id);
    const keyToEntry = new Map<string, string>();
    for (const e of dict) {
      keyToEntry.set(matchKey(e.canonical), e.id);
      for (const a of e.aliases) keyToEntry.set(matchKey(a), e.id);
    }
    const byKey = new Map<string, { answers: number; forms: Map<string, number> }>();
    let rows = 0;
    for (const r of fresh) {
      if (r.discovery_brands === null) continue;
      rows++;
      const seen = new Set<string>();
      for (const b of JSON.parse(r.discovery_brands) as string[]) {
        const k = matchKey(b);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        const g = byKey.get(k) ?? { answers: 0, forms: new Map() };
        g.answers++;
        g.forms.set(b, (g.forms.get(b) ?? 0) + 1);
        byKey.set(k, g);
      }
    }
    const observed = [...byKey.entries()]
      .map(([k, g]) => ({
        name: [...g.forms.entries()].sort((a, b) => b[1] - a[1])[0][0],
        entry_id: keyToEntry.get(k) ?? null,
        answers: g.answers,
      }))
      .sort((a, b) => b.answers - a.answers)
      // tracked entries always kept; emerged names only above 0.5% of rows
      .filter((o) => o.entry_id !== null || o.answers >= rows * 0.005)
      .slice(0, 80);
    await store.setBrandObservations(
      project.id,
      JSON.stringify({ rows, generated_at: new Date().toISOString(), observed })
    );
    await store.queueDictionaryCandidates(
      project.id,
      observed.filter((o) => !o.entry_id).map((o) => o.name)
    );
    // Junk filter + pre-warmed suggestions, so the gate opens onto a sorted
    // tray instead of a spinner.
    try {
      const pending = (await store.getDictionary(project.id)).filter(
        (e) => e.status === "pending"
      );
      if (pending.length > 0) {
        const nonBrands = await classifyNonBrands(pending.map((e) => e.canonical));
        let excluded = 0;
        for (const e of pending) {
          if (nonBrands.has(e.canonical.trim().toLowerCase())) {
            await store.upsertDictionaryEntry({
              id: e.id,
              projectId: project.id,
              canonical: e.canonical,
              aliases: e.aliases,
              status: "rejected",
            });
            excluded++;
          }
        }
        if (excluded > 0) await store.bumpDictionaryVersion(project.id);
      }
      await getDictionarySuggestions(project.id, project.category);
    } catch (err) {
      console.error("bootstrap dictionary prep failed:", err);
    }
  }

  await store.updateRunStatus(
    runId,
    "collected",
    "codebook proposed - awaiting confirmation"
  );
  return "gated";
}
