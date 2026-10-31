import { matchKey } from "../brand_key";
import { ENGINES, engineDisplayLabel } from "./providers";
import { buildResolver } from "./brand_resolve";
import { containsSeq, famTokens } from "./brand_family";
import { roleOf } from "./headline";
import {
  DEST_OUTSIDE,
  PICK_OUTSIDE,
  VERDICT_FIELDS,
  encodeVerdict,
  type WbMention,
  type WbRow,
} from "./measures";
import { cachedView, corePanel, type ViewData } from "./view_data";
import { SCHEMA_FIELDS, schemaOf, viewsOf, type ViewKey } from "./views";
import type { Intent, Project, Run } from "../types";

export type { WbMention, WbRow };

/**
 * The Workbench view (2026-10-30): the analyst's slicing surface, read from
 * answer_codes under the project's codes_source. Unlike the other per-type
 * views this one does not pre-aggregate: it ships ONE compact fact table -
 * per coded answer, its engine, prompt, outcome, resolved pick, resolved
 * mentions with framing in order of first appearance, and reason codes - so
 * every filter (brand set, grain, engine scope, split) slices in the
 * browser. One load per open, no per-slice refetch (the legacy slices route
 * recomputed server-side per brand x engine-subset request).
 *
 * Pools follow the presentation rule (CODING_DECISIONS sections 8 and 12):
 * `rows` is the HEADLINE pool (open-choice answers on the core panel) and
 * carries outcome / pick / reasons - the funnel, Why and Battleground read
 * only it. `extra` is every other coded answer on the core panel with its
 * mention framings alone - Risk's framing table reads rows + extra, since a
 * negative mention is a negative wherever the question came from. `doubt`
 * is the per-engine rollup of the doubt verdicts (objections and
 * churn/renewal), target-only by construction.
 *
 * Dropped from the legacy Workbench, not faked: Sources (citations are
 * responses metadata, not answer_codes - waits for its own round), Style
 * (same), Answers (reads answer bodies through the legacy coder columns),
 * and negative verbatim quotes (the labels' quote field is the row's
 * verdict receipt, not per-brand evidence - the read-time evidence layer is
 * the successor). Position metrics stay: mentions carry first-appearance
 * rank, so order among tracked brands is real measurement, encoded here as
 * the mention array's order.
 *
 * wb2 (2026-10-30, WORKBENCH_REDESIGN_2026-10-30.md): the typed chassis
 * every analysis lens rides. `facts` carries EVERY coded answer on the core
 * panel, typed by its schema - verdict enums (measures.ts VERDICT_FIELDS,
 * NOT_ASKED where the schema does not ask the field), resolved destinations
 * / redirects, reasons or topics, and an index into `responseIds` for the
 * evidence drill. Prompts carry the slicing dimensions: stage, view keys,
 * buyer room (intent.situation), worry (intent.concern), angle and the
 * named rival or class brand. Which measure may be read on which pool is
 * measures.ts's job alone. `rows` / `extra` / `doubt` / `codes` are wb1's
 * shape, kept unchanged for the retiring wb1 surface (workbench_codes.tsx);
 * drop them with it.
 */

export interface WorkbenchBrand {
  name: string;
  role: "target" | "competitor" | "emerged";
  /** Parent-company label for the parents grain; null = its own parent. */
  parent: string | null;
  /** False = active but un-analyzed: counted in denominators (a pick of it
   * is still in-category) but hidden from pickers and tables. */
  listed: boolean;
}

export interface WorkbenchEngine {
  id: string;
  label: string;
  mode: "instinct" | "search";
}

export interface WorkbenchPrompt {
  text: string;
  stage: string;
  /** True = headline (open-choice) pool - the Battleground's rows. */
  open: boolean;
  /** wb2: the views the cell routes to (viewsOf - usually one). */
  views: ViewKey[];
  /** Index into `rooms` (intent.situation); -1 = room-invariant cell. */
  room: number;
  /** Index into `worries` (intent.concern); -1 = not a worry cell. */
  worry: number;
  /** Index into `angles` (intent.angle) on head-to-heads and alternatives;
   * -1 elsewhere. */
  angle: number;
  /** Brand index of the rival the cell names (entity head-to-heads, rival
   * leavers) or of a class cell's class brand; -1 = none or unresolved. */
  rival: number;
}

/** Open-pool answer: [engine, prompt, outcome, pick, mentions, reasons].
 * outcome: 0 pick / 1 conditional / 2 no_pick / 3 clarification / -1 other.
 * pick: brand index; -2 = firm pick outside the category; -1 = none. */
export type WbOpenRow = [number, number, number, number, WbMention[], number[]];

/** Any other coded answer: [engine, prompt, mentions]. */
export type WbExtraRow = [number, number, WbMention[]];

/** Per-engine doubt verdicts. buyers = objections (stay = proceed, go =
 * avoid); customers = churn/renewal (stay = keep, go = leave). */
export interface WorkbenchDoubt {
  engine: number;
  kind: "buyers" | "customers";
  answers: number;
  stay: number;
  go: number;
  judged: number;
  confirms: number;
}

export interface WorkbenchView {
  runId: string;
  projectId: string;
  source: string;
  brand: string;
  /** Index of the target in `brands`. */
  target: number;
  /** Open-pool answers on the core panel, and those with no code row. */
  answers: number;
  uncoded: number;
  /** Most-named first; index-addressed by rows/extra. */
  brands: WorkbenchBrand[];
  engines: WorkbenchEngine[];
  prompts: WorkbenchPrompt[];
  /** Reason vocabulary, most argued first; index-addressed by rows. */
  codes: string[];
  rows: WbOpenRow[];
  extra: WbExtraRow[];
  doubt: WorkbenchDoubt[];
  /** wb2 interned dimension tables, index-addressed by prompts. */
  rooms: string[];
  worries: string[];
  angles: string[];
  /** wb2 argument vocabulary (reasons, and topics on awareness), most
   * carried first; index-addressed by facts. */
  args: string[];
  /** wb2: answer ids, index-addressed by facts (the evidence drill). */
  responseIds: string[];
  /** wb2: every coded answer on the core panel, typed (measures.ts WbRow). */
  facts: WbRow[];
}

const OUTCOMES = ["pick", "conditional", "no_pick", "clarification"];

/** The fields a schema asks, as a set (views.ts SCHEMA_FIELDS). */
const askedOf = new Map(
  Object.entries(SCHEMA_FIELDS).map(([k, v]) => [k, new Set<string>(v)])
);

export function computeWorkbench(data: ViewData): WorkbenchView {
  const { run, project, source, dictionary } = data;
  const resolve = buildResolver(dictionary, data.judged);
  const targetKey = resolve(project.brand).key;
  const legacy = new Set(project.competitors.map(matchKey));
  const entryByKey = new Map(dictionary.map((e) => [e.id, e]));

  // Class cells name their class brand only in the text: the longest active
  // entry form found there, the client excluded (head_to_head.ts's rule).
  const forms: { seq: string[]; key: string }[] = [];
  for (const e of dictionary) {
    if (e.status !== "active" || e.id === targetKey) continue;
    for (const f of [e.canonical, ...e.aliases]) forms.push({ seq: famTokens(f), key: e.id });
  }
  const classBrandOf = (text: string): string | null => {
    const hay = famTokens(text);
    let best: { seq: string[]; key: string } | null = null;
    for (const f of forms) if (containsSeq(hay, f.seq) && (!best || f.seq.length > best.seq.length)) best = f;
    return best?.key ?? null;
  };

  // The pool: every answer whose cell routes to any view, open flagged.
  const intentById = new Map(data.intents.map((i) => [i.id, i]));
  interface PromptMeta {
    intent: Intent;
    views: ViewKey[];
    asked: Set<string>;
    open: boolean;
    doubt: "buyers" | "customers" | null;
    rivalKey: string | null;
  }
  const promptMeta = new Map<string, PromptMeta>();
  for (const p of data.prompts) {
    const it = p.intent_id ? intentById.get(p.intent_id) : undefined;
    if (!it) continue;
    const views = viewsOf(it.stage, it.angle);
    const schema = schemaOf(it.stage, it.angle);
    if (views.length === 0 || !schema) continue;
    let rivalKey: string | null = null;
    if (views.includes("head_to_head_class")) {
      rivalKey = classBrandOf(it.text);
    } else if (views.includes("head_to_head_entity") || (views.includes("offensive_capture") && it.angle !== "generic")) {
      const r = resolve(it.angle);
      rivalKey = r.status === "active" && r.key !== targetKey ? r.key : null;
    }
    promptMeta.set(p.id, {
      intent: it,
      views,
      asked: askedOf.get(schema) ?? new Set(),
      open: views.includes("headline"),
      doubt: views.includes("doubt") ? "buyers" : views.includes("keep_or_leave") ? "customers" : null,
      rivalKey,
    });
  }
  const core = corePanel(data);
  const pool = new Map<string, { promptId: string; model: string } & PromptMeta>();
  for (const r of data.responses) {
    const meta = promptMeta.get(r.prompt_id);
    const model = r.model ?? run.model;
    if (meta && core.has(model)) pool.set(r.id, { promptId: r.prompt_id, model, ...meta });
  }

  // Pass 1: resolve every answer's facts against brand/prompt/code KEYS;
  // indices are assigned after the tallies so the lists sort by volume.
  interface Fact {
    responseId: string;
    model: string;
    promptId: string;
    open: boolean;
    doubt: "buyers" | "customers" | null;
    outcome: number;
    pickKey: string | null; // brand key, "" = out-of-category firm pick
    mentions: { key: string; bits: number }[];
    reasons: string[];
    /** wb2: reasons, or topics where the schema asks topics. */
    args: string[];
    verdicts: number[];
    /** wb2: resolved destination / redirect keys; "" = outside. */
    dests: string[];
    stayGo: "stay" | "go" | null;
    premise: "confirms" | "other" | null;
  }
  const facts: Fact[] = [];
  const named = new Map<string, number>();
  let openAnswers = 0;
  let openCoded = 0;
  for (const at of pool.values()) if (at.open) openAnswers++;
  for (const c of data.codes) {
    const at = pool.get(c.response_id);
    if (!at) continue;
    if (at.open) openCoded++;
    // Mentions: active entries only, min rank per brand, framings OR'd.
    const byBrand = new Map<string, { bits: number; rank: number }>();
    for (const m of c.mentions ?? []) {
      const r = resolve(m.brand);
      if (r.status !== "active") continue;
      const prev = byBrand.get(r.key);
      const bits = (m.framing === "recommended" ? 1 : 0) | (m.framing === "negative" ? 2 : 0);
      if (prev) {
        prev.bits |= bits;
        prev.rank = Math.min(prev.rank, m.rank);
      } else {
        byBrand.set(r.key, { bits, rank: m.rank });
      }
    }
    let pickKey: string | null = null;
    if (c.outcome === "pick" && c.top_pick) {
      const r = resolve(c.top_pick);
      if (r.status === "active") {
        pickKey = r.key;
        // The crowned brand always counts as named and recommended
        // (headline.ts factsOf); an unranked pick sits after the mentions.
        const prev = byBrand.get(r.key);
        if (prev) prev.bits |= 1;
        else byBrand.set(r.key, { bits: 1, rank: Number.MAX_SAFE_INTEGER });
      } else {
        pickKey = "";
      }
    }
    const mentions = [...byBrand.entries()]
      .sort((a, b) => a[1].rank - b[1].rank)
      .map(([key, v]) => ({ key, bits: v.bits }));
    for (const m of mentions) named.set(m.key, (named.get(m.key) ?? 0) + 1);
    const stayGo =
      at.doubt === "buyers"
        ? c.proceed_or_avoid === "proceed" ? ("stay" as const) : c.proceed_or_avoid === "avoid" ? ("go" as const) : null
        : at.doubt === "customers"
          ? c.keep_or_leave === "keep" ? ("stay" as const) : c.keep_or_leave === "leave" ? ("go" as const) : null
          : null;
    // Destinations and redirects: one slot (no schema asks both), deduped
    // per answer; the client's own product resolves to the target key.
    const destNames = at.asked.has("destinations") ? c.destinations : at.asked.has("redirect_to") ? c.redirect_to : null;
    const dests = new Set<string>();
    for (const d of destNames ?? []) {
      const r = resolve(d);
      dests.add(r.status === "active" ? r.key : "");
    }
    const args = at.asked.has("reasons") ? c.reasons ?? [] : at.asked.has("topics") ? c.topics ?? [] : [];
    facts.push({
      responseId: c.response_id,
      model: at.model,
      promptId: at.promptId,
      open: at.open,
      doubt: at.doubt,
      outcome: c.outcome ? OUTCOMES.indexOf(c.outcome) : -1,
      pickKey,
      mentions,
      reasons: at.open ? (c.reasons ?? []) : [],
      args: [...new Set(args)],
      verdicts: VERDICT_FIELDS.map((f) => encodeVerdict(f, c[f], at.asked.has(f))),
      dests: [...dests],
      stayGo,
      premise: c.premise_verdict === null ? null : c.premise_verdict === "confirms" ? "confirms" : "other",
    });
  }

  // Brand list: every active brand the pool names plus the target, most
  // named first; un-analyzed actives stay as unlisted denominators. Rivals
  // the cells name and exits the answers offer join at zero volume.
  if (!named.has(targetKey)) named.set(targetKey, 0);
  for (const f of facts) for (const d of f.dests) if (d && !named.has(d)) named.set(d, 0);
  for (const m of promptMeta.values()) if (m.rivalKey && !named.has(m.rivalKey)) named.set(m.rivalKey, 0);
  const brandKeys = [...named.keys()].sort(
    (a, b) => (named.get(b) ?? 0) - (named.get(a) ?? 0) || a.localeCompare(b)
  );
  const brandIdx = new Map(brandKeys.map((k, i) => [k, i]));
  const brands: WorkbenchBrand[] = brandKeys.map((key) => {
    const entry = entryByKey.get(key) ?? null;
    return {
      name: entry ? entry.display_name ?? entry.canonical : project.brand,
      role: roleOf(key, targetKey, entry, legacy),
      parent: entry?.parent ?? null,
      listed: key === targetKey || !entry || entry.analyzed,
    };
  });

  // Engine, prompt and code indices, by volume where it reads better.
  const engineMeta = new Map(ENGINES.map((e) => [e.id, { label: engineDisplayLabel(e), mode: e.mode }]));
  const engineIds = [...core].filter((m) => facts.some((f) => f.model === m));
  const engineIdx = new Map(engineIds.map((m, i) => [m, i]));
  const engines: WorkbenchEngine[] = engineIds.map((id) => {
    const meta = engineMeta.get(id);
    return { id, label: meta?.label ?? id, mode: meta?.mode ?? "instinct" };
  });
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
  const promptIds = [...new Set(facts.map((f) => f.promptId))];
  const promptIdx = new Map(promptIds.map((p, i) => [p, i]));
  const promptText = new Map(data.prompts.map((p) => [p.id, p.text]));
  const prompts: WorkbenchPrompt[] = promptIds.map((id) => {
    const meta = promptMeta.get(id)!;
    const it = meta.intent;
    const rivalBearing = it.stage === "comparison" || it.stage === "alternatives";
    return {
      text: promptText.get(id) ?? "",
      stage: it.stage,
      open: meta.open,
      views: meta.views,
      room: rooms.get(it.situation),
      worry: worries.get(it.concern),
      angle: rivalBearing ? angles.get(it.angle) : -1,
      rival: meta.rivalKey ? brandIdx.get(meta.rivalKey)! : -1,
    };
  });
  const tally = (lists: string[][]) => {
    const count = new Map<string, number>();
    for (const l of lists) for (const r of l) count.set(r, (count.get(r) ?? 0) + 1);
    const out = [...count.keys()].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0) || a.localeCompare(b));
    return { list: out, idx: new Map(out.map((c, i) => [c, i])) };
  };
  // wb1's vocabulary: open-pool reasons only (its Why table lists every one).
  const { list: codes, idx: codeIdx } = tally(facts.map((f) => f.reasons));
  const { list: args, idx: argIdx } = tally(facts.map((f) => f.args));

  // Pass 2: encode.
  const rows: WbOpenRow[] = [];
  const extra: WbExtraRow[] = [];
  const wb2: WbRow[] = [];
  const responseIds: string[] = [];
  const doubtAgg = new Map<string, WorkbenchDoubt>();
  for (const f of facts) {
    const e = engineIdx.get(f.model)!;
    const p = promptIdx.get(f.promptId)!;
    const mentions: WbMention[] = f.mentions.map((m) => [brandIdx.get(m.key)!, m.bits]);
    const pick = f.pickKey === null ? -1 : f.pickKey === "" ? PICK_OUTSIDE : brandIdx.get(f.pickKey)!;
    if (f.open) {
      rows.push([e, p, f.outcome, pick, mentions, f.reasons.map((r) => codeIdx.get(r)!)]);
    } else {
      extra.push([e, p, mentions]);
    }
    wb2.push([
      e,
      p,
      responseIds.length,
      pick,
      mentions,
      f.args.map((a) => argIdx.get(a)!),
      f.verdicts,
      f.dests.map((d) => (d === "" ? DEST_OUTSIDE : brandIdx.get(d)!)),
    ]);
    responseIds.push(f.responseId);
    if (f.doubt) {
      const k = `${e}:${f.doubt}`;
      const d = doubtAgg.get(k) ?? { engine: e, kind: f.doubt, answers: 0, stay: 0, go: 0, judged: 0, confirms: 0 };
      d.answers++;
      if (f.stayGo === "stay") d.stay++;
      if (f.stayGo === "go") d.go++;
      if (f.premise !== null) d.judged++;
      if (f.premise === "confirms") d.confirms++;
      doubtAgg.set(k, d);
    }
  }

  return {
    runId: run.id,
    projectId: project.id,
    source,
    brand: project.brand,
    target: brandIdx.get(targetKey)!,
    answers: openCoded,
    uncoded: openAnswers - openCoded,
    brands,
    engines,
    prompts,
    codes,
    rows,
    extra,
    doubt: [...doubtAgg.values()],
    rooms: rooms.list,
    worries: worries.list,
    angles: angles.list,
    args,
    responseIds,
    facts: wb2,
  };
}

// wb2 (2026-10-30): typed facts for every coded answer - the output changed
// for identical inputs, so the cache era moves (cache-era case 2).
const WORKBENCH_VERSION = "wb2";
export function computeWorkbenchCached(run: Run, project: Project): Promise<WorkbenchView | null> {
  return cachedView("workbench", WORKBENCH_VERSION, run, project, computeWorkbench, { judge: true });
}
