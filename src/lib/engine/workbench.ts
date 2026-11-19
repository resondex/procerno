import { matchKey } from "../brand_key";
import { ENGINES, engineDisplayLabel } from "./providers";
import { roleOf } from "./view_types";
import { buildAnswerFacts, type AnswerFact } from "./facts/answer_facts";
import { VERDICT_FIELDS, VERDICT_VALUES } from "./facts/basics";
import { dataPoolOf } from "./facts/measure_book";
import { cachedView, coreOf, facetsOf, requestOf, type ViewData, type ViewRequest } from "./view_data";
import type { WbBrand, WbEngine, WbFact, WbPrompt, WorkbenchView } from "./workbench_rows";
import type { Project, Run } from "../types";

export type { WbBrand, WbEngine, WbFact, WbPrompt, WorkbenchView } from "./workbench_rows";

/**
 * The Data page's payload (fact layer step 6, 2026-11-17): the run's ANSWER FACTS - the same per-answer records
 * (facts/answer_facts.ts) every other screen reads - in a compact, index-addressed form, so every table is cut in
 * the browser from one fetch per open and every cell is counted with the same measure book (facts/measure_book.ts,
 * read in the browser through workbench_rows.ts). Nothing here counts: the page names each cell's fact and counts
 * it with the measure's own base and numerator.
 *
 * What a row carries is what the measures read (workbench_rows.ts decodes it back into an AnswerFact):
 *   [engine, prompt, response, pick, brands, args, verdicts, sent, price, sources]
 *  - pick: index into `brands` of the pick (any bucket - ruling 8 reads the brand's bucket); -1 = no pick;
 *  - brands: [index, bits] for every brand IN ANALYSIS the answer names, in order of first appearance (bits: 1
 *    recommended - a pick counts, ruling 6 -, 2 named as one to avoid); brands outside of analysis are left out
 *    (ruling 8: never a subject, never a row);
 *  - args: argument or topic indexes; verdicts: one per VERDICT_FIELDS, -1 = not asked, else the value's index;
 *  - sent: null = not asked, else [brands in analysis it sends the buyer to, how many of the tracker's own other
 *    products it offers];
 *  - price: null = not a price question, else [0 a rival / 1 only your own option / 2 nowhere (ruling 3), the rivals
 *    it recommends instead];
 *  - sources: null = the assistant does not search, else the indexes into `sources` of the sites it cites (one per
 *    distinct site, facts/sources.ts); `sourceOwner` says whose own site each is (none, one or several brands).
 *
 * The first version's rollups (rows / extra / doubt / codes) are gone: nothing read them.
 */
export function computeWorkbench(data: ViewData, request: ViewRequest = {}): WorkbenchView {
  const { run, project, dictionary } = data;
  const core = coreOf(data, request);
  const set = buildAnswerFacts(data, request.engines ? { engines: [...core] } : {});
  const T = set.target.key;
  const legacy = new Set(project.competitors.map(matchKey));
  const entryById = new Map(dictionary.map((e) => [e.id, e]));

  // Brands: every key a row can point at - brands in analysis named, picks of any bucket, the rivals questions name,
  // where the buyer is sent, rivals recommended instead. Most named first; the tracker always listed.
  const named = new Map<string, number>([[T, 0]]);
  const names = new Map<string, string>([[T, set.target.name]]);
  const see = (key: string | null | undefined, name: string | null | undefined, count = 0) => {
    if (!key) return;
    named.set(key, (named.get(key) ?? 0) + count);
    if (!names.has(key) && name) names.set(key, name);
  };
  for (const f of set.facts) {
    for (const b of f.brands) if (b.bucket === "in_analysis") see(b.key, b.name, 1);
    if (f.pick.state !== "none") see(f.pick.key, f.pick.name);
    see(f.rival?.key, f.rival?.name);
    for (const b of f.sent?.brands ?? []) see(b.key, b.name);
    for (const r of f.price?.rivals ?? []) see(r.key, r.name);
    for (const x of f.sources ?? []) for (const o of x.owners) see(o, set.nameOf(o));
  }
  const brandKeys = [...named.keys()].sort((a, b) => (named.get(b) ?? 0) - (named.get(a) ?? 0) || a.localeCompare(b));
  const brandIdx = new Map(brandKeys.map((k, i) => [k, i]));
  const brands: WbBrand[] = brandKeys.map((key) => {
    const entry = entryById.get(key) ?? null;
    const bucket = set.bucketOf(key);
    return {
      key,
      name: key === T ? project.brand : entry ? entry.display_name ?? entry.canonical : names.get(key) ?? key,
      role: roleOf(key, T, entry, legacy),
      parent: entry?.parent ?? null,
      bucket,
      listed: bucket === "in_analysis",
      ...(entry?.aliases?.length ? { aliases: entry.aliases } : {}),
    };
  });

  // Engines on the panel that answered, in panel order.
  const engineMeta = new Map(ENGINES.map((e) => [e.id, engineDisplayLabel(e)]));
  const engineIds = [...core].filter((m) => set.facts.some((f) => f.engine.id === m));
  const engineIdx = new Map(engineIds.map((m, i) => [m, i]));
  const engines: WbEngine[] = engineIds.map((id) => ({ ...facetsOf(id), id, label: engineMeta.get(id) ?? id }));

  const intern = () => {
    const list: string[] = [];
    const at = new Map<string, number>();
    const get = (s: string | null | undefined) => {
      if (!s) return -1;
      let i = at.get(s);
      if (i === undefined) {
        i = list.length;
        list.push(s);
        at.set(s, i);
      }
      return i;
    };
    return { list, get };
  };
  const rooms = intern();
  const worries = intern();
  const angles = intern();
  const cellIds = intern();
  const promptText = new Map(data.prompts.map((p) => [p.id, p.text]));
  const intentById = new Map(data.intents.map((i) => [i.id, i]));
  const promptIds = [...new Set(set.facts.map((f) => f.promptId))];
  const promptIdx = new Map(promptIds.map((p, i) => [p, i]));
  const firstOf = new Map<string, AnswerFact>();
  for (const f of set.facts) if (!firstOf.has(f.promptId)) firstOf.set(f.promptId, f);
  const prompts: WbPrompt[] = promptIds.map((id) => {
    const f = firstOf.get(id)!;
    return {
      text: promptText.get(id) ?? "",
      stage: f.stage,
      type: f.type,
      pool: dataPoolOf(f.type)!,
      room: rooms.get(f.situation),
      worry: worries.get(f.worry),
      angle: f.stage === "comparison" || f.stage === "alternatives" ? angles.get(f.angle) : -1,
      rival: f.rival ? brandIdx.get(f.rival.key)! : -1,
      cell: cellIds.get(f.intentId),
    };
  });

  // Arguments and topics, most carried first.
  const argCount = new Map<string, number>();
  for (const f of set.facts) for (const a of f.args ?? []) argCount.set(a, (argCount.get(a) ?? 0) + 1);
  const args = [...argCount.keys()].sort((a, b) => (argCount.get(b) ?? 0) - (argCount.get(a) ?? 0) || a.localeCompare(b));
  const argIdx = new Map(args.map((a, i) => [a, i]));

  // Sources: the sites cited, most cited first, each with the brand whose own site it is.
  const srcCount = new Map<string, number>();
  const srcOwner = new Map<string, string[]>();
  for (const f of set.facts)
    for (const x of f.sources ?? []) {
      srcCount.set(x.site, (srcCount.get(x.site) ?? 0) + 1);
      srcOwner.set(x.site, x.owners);
    }
  const sources = [...srcCount.keys()].sort((a, b) => (srcCount.get(b) ?? 0) - (srcCount.get(a) ?? 0) || a.localeCompare(b));
  const srcIdx = new Map(sources.map((x, i) => [x, i]));
  const sourceOwner = sources.map((x) => (srcOwner.get(x) ?? []).map((o) => brandIdx.get(o)).filter((i): i is number => i !== undefined));

  const responseIds: string[] = [];
  const facts: WbFact[] = set.facts.map((f) => {
    const row: WbFact = [
      engineIdx.get(f.engine.id)!,
      promptIdx.get(f.promptId)!,
      responseIds.length,
      f.pick.state === "none" ? -1 : brandIdx.get(f.pick.key!)!,
      f.brands.filter((b) => b.bucket === "in_analysis").map((b) => [brandIdx.get(b.key)!, (b.recommended ? 1 : 0) | (b.negative ? 2 : 0)]),
      (f.args ?? []).map((a) => argIdx.get(a)!),
      VERDICT_FIELDS.map((v) => {
        const x = f.verdicts[v];
        return x === undefined ? -1 : VERDICT_VALUES[v].indexOf(x);
      }),
      f.sent ? [f.sent.brands.map((b) => brandIdx.get(b.key)!), f.sent.own.length] : null,
      f.price ? [f.price.bucket === "rival" ? 0 : f.price.bucket === "own" ? 1 : 2, f.price.rivals.map((r) => brandIdx.get(r.key)!)] : null,
      f.sources ? f.sources.map((x) => srcIdx.get(x.site)!) : null,
    ];
    responseIds.push(f.responseId);
    return row;
  });

  // What to buy (ruling 7): coded answers on the panel, and its answers with no code row.
  const whatToBuy = new Set(data.intents.filter((i) => i.stage === "discovery" || i.stage === "use_case").map((i) => i.id));
  const wtbPrompts = new Set(data.prompts.filter((p) => p.intent_id && whatToBuy.has(p.intent_id)).map((p) => p.id));
  const coded = new Set(data.codes.map((c) => c.response_id));
  let wtbAll = 0;
  let wtbUncoded = 0;
  for (const r of data.responses) {
    if (!wtbPrompts.has(r.prompt_id) || !core.has(r.model ?? run.model)) continue;
    wtbAll++;
    if (!coded.has(r.id)) wtbUncoded++;
  }

  return {
    runId: run.id,
    projectId: project.id,
    source: data.source,
    brand: project.brand,
    target: brandIdx.get(T)!,
    answers: wtbAll - wtbUncoded,
    uncoded: wtbUncoded,
    engineScope: request.engines ? [...core].sort() : null,
    brands,
    engines,
    prompts,
    rooms: rooms.list,
    worries: worries.list,
    angles: angles.list,
    cells: cellIds.list.map((id) => intentById.get(id)?.text ?? ""),
    cellIds: cellIds.list,
    args,
    sources,
    sourceOwner,
    responseIds,
    facts,
  };
}

// wb2 (2026-10-30): typed facts for every coded answer - the output changed
// for identical inputs, so the cache era moves (cache-era case 2).
// wb4 (2026-11-03): engines carry vendor / tier (the Panel lens's Group-by).
// wb5 (2026-11-03): prompts carry their question (cell) + the seed wordings
// (the Metrics pivot's Question dimension).
// wb6: brands carry the dictionary's aliases (the Data page's search).
// wb7 (2026-11-17, fact layer step 6): the payload is the run's answer facts (facts/answer_facts.ts), counted in the
// browser with the measure book; the first version's rollups (rows / extra / doubt / codes) are dropped.
// wb8 (2026-11-18): the sites each answer cites (facts/sources.ts) and whose own site each is - the Data page's
// Source dimension and the source numbers.
// wb9 (2026-11-19): a site belongs to several brands (sourceOwner is a list per site), and whose it is comes from
// what a person entered, else the saved model check (engine/site_owner.ts), else the name match - both records ride
// the key (cachedView's siteOwners extra).
const WORKBENCH_VERSION = "wb9";
export function computeWorkbenchCached(run: Run, project: Project, request: ViewRequest = {}): Promise<WorkbenchView | null> {
  const r = requestOf(request);
  return cachedView("workbench", WORKBENCH_VERSION, run, project, (d) => computeWorkbench(d, r), { judge: true, setupDecision: true, siteOwners: true }, r);
}
