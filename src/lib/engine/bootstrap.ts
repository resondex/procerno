import { store } from "../store";
import { withCostContext } from "../cost_log";
import type { Project, ResponseRow } from "../types";
import { runBrandDiscovery, runOpenDiscovery, type DiscoveryAnswer } from "./discovery";
import { consolidateTaxonomy } from "./consolidate";
import { classifyNonBrands } from "./suggest";
import { refreshBrandObservations } from "./observations";
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

  // Stage 4: brand observations + the dictionary queue - the shared
  // recomputable implementation (family-aware attribution, 1% floor).
  if (!project.brand_observations) {
    await refreshBrandObservations(project.id);
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
