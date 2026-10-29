import { store } from "@/lib/store";
import { tagCosts } from "@/lib/cost_log";
import {
  humanize,
  participationMask,
  reviewJourneyFit,
  reviewScenarioFit,
  type Moderators,
  type ScenarioSpec,
} from "@/lib/engine/instrument";
import { ModeratorsShape } from "@/lib/engine/instrument_shapes";
import { brandAliasForms } from "@/lib/engine/brand_aliases";
import { deriveCheckSpec, WORRY_STANCE_STAGES } from "@/lib/engine/battery_checks";
import type { Project } from "@/lib/types";

/** Text identity for record lookups. Stored intent and prompt text went
 * through humanize (curly quotes, Unicode hyphens, dashes, ellipses, a
 * full quote wrap), while the decision record keeps the client's text - so
 * both sides fold through humanize before comparing, or a cell with
 * typographic characters loses its provenance. */
const norm = (t: string) => humanize(t).toLowerCase().replace(/\s+/g, " ").trim();

type Obj = Record<string, unknown>;
type Room = { label: string; description: string };

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const rooms = (v: unknown): Room[] =>
  Array.isArray(v)
    ? v.filter(isObj).flatMap((r) => {
        const label = str(r.label);
        return label ? [{ label, description: str(r.description) ?? "" }] : [];
      })
    : [];

/** A stored setup_decision, parsed defensively: null when absent or not
 * JSON (the record is advisory provenance - never fatal). */
function parseDecision(raw: string | null): Obj | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

/** The base-read enums in ModeratorsShape order; the first value is the
 * fallback when a legacy value cannot be recovered. */
const MODERATOR_ENUMS = {
  verifiability: ["spec", "taste", "trust"],
  involvement: ["considered", "habitual"],
  think_feel: ["think", "feel"],
  decision_unit: ["solo", "household", "committee"],
  rhythm: ["one_shot", "replenishment", "subscription"],
  risk: ["performance", "financial", "social", "physical"],
} as const;
const RATIONALE_MAX = 600;

/** A legacy stored base read that fails ModeratorsShape (create once
 * accepted any record), cleaned into one that passes: enum values
 * normalized ("One-shot" -> one_shot), unrecoverable ones set to the
 * schema's first value (logged - the setup banner's chips let the user
 * flip them), the flag coerced, overlong strings clamped to the schema's
 * caps, unknown fields dropped. Returning the RAW read instead made the
 * tracker open but every later route call (ModeratorsShape-validated) 400,
 * so the edit could never be saved. */
function cleanModerators(raw: Obj, projectId: string): Moderators {
  const out: Record<string, unknown> = {};
  for (const [field, values] of Object.entries(MODERATOR_ENUMS)) {
    const v = str(raw[field])?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? null;
    const hit = values.find((x) => x === v);
    if (!hit) {
      console.warn(`edit-setup ${projectId}: stored base read ${field}=${JSON.stringify(raw[field])} unrecoverable - using ${values[0]}`);
    }
    out[field] = hit ?? values[0];
  }
  const flag = raw.channel_retail;
  out.channel_retail = typeof flag === "boolean" ? flag : str(flag)?.trim().toLowerCase() === "true";
  out.rationale = (str(raw.rationale) ?? "").slice(0, RATIONALE_MAX);
  return out as unknown as Moderators;
}

/** The cell identity the decision record and the stored intents share. */
const cellKey = (c: { stage?: unknown; situation?: unknown; angle?: unknown; concern?: unknown }) =>
  `${str(c.stage) ?? ""}|${str(c.situation) ?? ""}|${str(c.angle) ?? ""}|${str(c.concern) ?? ""}`;

type WorryPair = { concern: string; stage: string };
/** The worries gate's card, as the wizard's WorryUi carries it. */
type WorryCard = {
  worry: string;
  detail: string;
  stances: string[];
  recommended: string;
  recommend: string[];
  overlaps?: string[];
};

/**
 * The worries gate's state rebuilt for edit-setup (2026-10-29): the
 * tracker's confirmed picks and the menu they were picked from, so the
 * wizard treats them as existing picks - fetchWorries skips on a non-empty
 * pool and the gate's pre-pick fires only on undefined picks, so nothing is
 * drawn or re-prefilled. Concern wording is carried VERBATIM from the
 * records and intents (trend continuity keys on string identity).
 *
 * Picks: worry_decision.decided, else setup_decision.worries.decided, else
 * the stored worry cells; the stored cells are always unioned in, so no
 * measured worry cell is ever orphaned from its pick. A worry cell is an
 * INVARIANT row (stage objections/churn_triggers/renewal, concern set,
 * situation null, angle generic) - the legacy concern zip also persisted
 * concerns, but on room-pinned rows too.
 *
 * Pool: setup_decision.worries.offered (the full menu; exact stances since
 * 2026-10-29, rebuilt from recommended + plan + picked stances on older
 * records), else worry_decision (recommended + decided concerns, no blurb),
 * else the picks themselves. Every pick's concern and stance is ensured on
 * its card.
 *
 * Returns null for a non-worry-era battery (no worries gate: the grid keeps
 * `worries` undefined so the cells route stays on the legacy zip path).
 */
export function rebuildWorryState(input: {
  /** setup_decision.worries: undefined = field absent (no record, or a
   * record from before the worries gate), null = recorded without a pool. */
  recordWorries: unknown;
  worryDecisionRaw: string | null;
  intents: { stage: string; situation: string | null; angle: string; concern?: string | null }[];
}): { worries: WorryPair[]; worryPool: WorryCard[]; worryOffered: string[] } | null {
  const stanceSet = new Set<string>(WORRY_STANCE_STAGES);
  const pairs = (v: unknown): WorryPair[] =>
    Array.isArray(v)
      ? v.filter(isObj).flatMap((p) => {
          const concern = str(p.concern);
          const stage = str(p.stage);
          return concern && concern.trim() && stage && stanceSet.has(stage) ? [{ concern, stage }] : [];
        })
      : [];
  const wd = parseDecision(input.worryDecisionRaw);
  const rec = isObj(input.recordWorries) ? input.recordWorries : null;
  const doubtCells = input.intents.filter((i) => i.concern && stanceSet.has(i.stage));
  const cellPicks = doubtCells
    .filter((i) => !i.situation && i.angle === "generic")
    .map((i) => ({ concern: i.concern as string, stage: i.stage }));

  // Era: either record says the worries gate ran. Without one, the stored
  // cells decide - a concern cell pinned to a room is the legacy zip's
  // signature (worry rows are never room-pinned), so that battery is zip-era.
  const worryEra =
    wd !== null || rec !== null ||
    (cellPicks.length > 0 && !doubtCells.some((i) => i.situation));
  if (!worryEra) return null;

  const pairKey = (p: WorryPair) => `${p.concern}|${p.stage}`;
  const recordPicks = wd && Array.isArray(wd.decided) ? pairs(wd.decided) : rec && Array.isArray(rec.decided) ? pairs(rec.decided) : [];
  const worries: WorryPair[] = [];
  const seen = new Set<string>();
  for (const p of [...recordPicks, ...cellPicks]) {
    if (seen.has(pairKey(p))) continue;
    seen.add(pairKey(p));
    worries.push(p);
  }

  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const stances = (v: unknown) => strings(v).filter((s) => stanceSet.has(s));
  let pool: WorryCard[];
  if (rec && Array.isArray(rec.offered)) {
    pool = rec.offered.filter(isObj).flatMap((w) => {
      const worry = str(w.worry);
      if (!worry) return [];
      const recommended = str(w.recommended) ?? "";
      const plan = stances(w.plan);
      const picked = worries.filter((p) => p.concern === worry).map((p) => p.stage);
      // Recorded stances are the menu exactly; older records rebuild them
      // from the natural stance, the plan and the stances picked at.
      const recorded = stances(w.stances);
      const all = [...new Set([...(recorded.length > 0 ? recorded : [recommended, ...plan]), ...picked].filter((s) => stanceSet.has(s)))];
      const overlaps = strings(w.overlaps);
      return [{ worry, detail: str(w.detail) ?? "", stances: all, recommended, recommend: plan, ...(overlaps.length ? { overlaps } : {}) }];
    });
  } else {
    const recommendedPairs = wd && Array.isArray(wd.recommended) ? pairs(wd.recommended) : [];
    // No record of the recommendation: the picks stand in for it, so the
    // gate's pre-lit chips and plan count match what was confirmed.
    const planPairs = wd ? recommendedPairs : worries;
    const order = [...new Set([...recommendedPairs, ...worries].map((p) => p.concern))];
    pool = order.map((worry) => {
      const plan = [...new Set(planPairs.filter((p) => p.concern === worry).map((p) => p.stage))];
      const all = [...new Set([...recommendedPairs, ...worries].filter((p) => p.concern === worry).map((p) => p.stage))];
      return { worry, detail: "", stances: all, recommended: plan[0] ?? all[0], recommend: plan };
    });
  }
  // Every pick on a card, at a lit-able stance.
  for (const p of worries) {
    const card = pool.find((w) => w.worry === p.concern);
    if (!card) pool.push({ worry: p.concern, detail: "", stances: [p.stage], recommended: p.stage, recommend: [] });
    else if (!card.stances.includes(p.stage)) card.stances = [...card.stances, p.stage];
  }
  for (const w of pool) if (!stanceSet.has(w.recommended)) w.recommended = w.stances[0] ?? "";
  const recordedOffered = rec ? stances(rec.offeredStances) : [];
  const worryOffered = [...new Set([...recordedOffered, ...pool.flatMap((w) => w.stances)])];
  return { worries, worryPool: pool, worryOffered };
}

/** A zero-run tracker's instrument rendered back into the wizard-draft
 * shape - shared by the /api setup route and the server-rendered /app
 * page (the Edit setup click opens the wizard in ONE navigation).
 * Returns null when the tracker has runs (locked) or was not built with
 * the Landscape setup. Callers have already checked access.
 *
 * Source of truth (2026-10-24): the tracker's own setup_decision record
 * (rooms, Value lines, per-room stage scope, worries, the base read as
 * offered) plus the stored intents/prompts - never a fresh market read.
 * The old path re-read room descriptions from the shared category-read
 * cache by label: brand-aware, near-variant, reworded and user rooms came
 * back blank (re-keying every scenario cell against empty rooms), and on
 * a cold key the page render paid a full ~2-minute market read. */
export async function buildEditSetupDraft(project: Project) {
  tagCosts({ projectId: project.id, purpose: "edit_setup" });
  const id = project.id;
  const storedJourneys = (() => {
    const raw = (project as unknown as { scenario_journeys?: string | null }).scenario_journeys;
    if (!raw) return {} as Record<string, ScenarioSpec["journey"]>;
    try { return JSON.parse(raw) as Record<string, ScenarioSpec["journey"]>; } catch { return {}; }
  })();
  const latest = await store.latestRuns([id]);
  if (latest[id]) return null;
  const intents = await store.listIntents(id);
  const moderators = (project as unknown as { moderators?: string | null }).moderators;
  if (!moderators || intents.length === 0) return null;
  // Guarded: a malformed stored read is "not editable here", never a 500
  // on the page render.
  let base: Moderators;
  try {
    const raw = JSON.parse(moderators) as unknown;
    if (!isObj(raw)) return null;
    const checked = ModeratorsShape.safeParse(raw);
    // A read stored before validation (create accepted any record) still
    // opens AND saves: it is cleaned into one the wizard's validated route
    // calls accept, never handed back raw.
    if (checked.success) {
      base = checked.data as Moderators;
    } else {
      const cleaned = ModeratorsShape.safeParse(cleanModerators(raw, project.id));
      if (!cleaned.success) return null;
      base = cleaned.data as Moderators;
    }
  } catch {
    return null;
  }
  const [prompts, decisionRaw, worryDecisionRaw] = await Promise.all([
    store.listPrompts(id),
    store.getSetupDecision(id).catch(() => null),
    store.getWorryDecision(id).catch(() => null),
  ]);
  const decision = parseDecision(decisionRaw);
  const dRooms = isObj(decision?.rooms) ? (decision!.rooms as Obj) : null;
  const dStages = isObj(decision?.stages) ? (decision!.stages as Obj) : null;
  const dValue = isObj(decision?.valueLines) ? (decision!.valueLines as Obj) : null;
  const dBase = isObj(decision?.base) ? (decision!.base as Obj) : null;

  const situations = [...new Set(intents.map((i) => i.situation).filter(Boolean))] as string[];
  // Room descriptions: the decided rooms as confirmed at create. Without a
  // record (trackers created before 2026-10-06) the descriptions stay blank
  // and editable - deliberately NOT a market read here: composeInstrument
  // claims and generates on a cold key even with noWait, so a page render
  // could block ~2 min and pay for a full read. Blank descriptions are the
  // cheaper failure: the user can fill them, and nothing redraws unless
  // coverage is re-confirmed.
  const decided = new Map<string, { description: string; journey: unknown; how: string | null }>();
  if (dRooms && Array.isArray(dRooms.decided)) {
    for (const r of dRooms.decided.filter(isObj)) {
      const label = str(r.label);
      if (label) decided.set(label, { description: str(r.description) ?? "", journey: r.journey ?? null, how: str(r.how) });
    }
  }
  const offered = rooms(dRooms?.offered);
  const offeredBy = new Map(offered.map((r) => [r.label, r]));
  // Journey deltas come back from the tracker (persisted since the
  // flattening bug): the deviating scenario keeps buying differently
  // through an edit, and the mask recomputes true to the design.
  const scenarios: ScenarioSpec[] = situations.map((label) => ({
    label,
    description: decided.get(label)?.description ?? "",
    journey: storedJourneys[label] ?? ((decided.get(label)?.journey as ScenarioSpec["journey"]) ?? null),
  }));
  const stages = participationMask(base, scenarios);
  const decidedKept = Array.isArray(dStages?.kept) ? (dStages!.kept as unknown[]).filter((k): k is string => typeof k === "string") : [];
  const keptStages = [...new Set([...decidedKept, ...intents.map((i) => i.stage)])];

  // Value lines per room, as decided (null = no Value cell for the room).
  const valueLines: Record<string, { line: string; counterpart: string } | null> | undefined = isObj(dValue?.decided)
    ? Object.fromEntries(
        Object.entries(dValue!.decided as Obj).map(([room, v]) => [
          room,
          isObj(v) && str(v.line) && str(v.counterpart) ? { line: str(v.line)!, counterpart: str(v.counterpart)! } : null,
        ])
      )
    : undefined;
  const valueRecommended = isObj(dValue?.recommended)
    ? Object.fromEntries(Object.entries(dValue!.recommended as Obj).map(([k, v]) => [k, str(v)]))
    : undefined;
  const stageRooms = isObj(dStages?.stageRooms)
    ? Object.fromEntries(
        Object.entries(dStages!.stageRooms as Obj).flatMap(([k, v]) =>
          Array.isArray(v) ? [[k, v.filter((x): x is string => typeof x === "string")]] : []
        )
      )
    : undefined;

  // Worries: rebuilt from the records so the gate never redraws or
  // re-prefills (a redraw rewords the worries and orphans the picks).
  const worryState = rebuildWorryState({
    recordWorries: decision && Object.prototype.hasOwnProperty.call(decision, "worries") ? decision.worries : undefined,
    worryDecisionRaw,
    intents,
  });

  // Per-seed provenance from the record, keyed by cell identity + the
  // decided text (custom questions can share an identity).
  const dCells = Array.isArray(decision?.cells) ? (decision!.cells as unknown[]).filter(isObj) : [];
  const dCellBy = new Map<string, Obj>();
  for (const c of dCells) {
    const seed = isObj(c.seed) ? c.seed : null;
    const text = str(seed?.decided);
    if (text) dCellBy.set(`${cellKey(c)}|${norm(text)}`, c);
  }

  const byIntent = new Map<string, { text: string; asker: string }[]>();
  for (const p of prompts) {
    const key = (p as unknown as { intent_id: string | null }).intent_id;
    if (!key) continue;
    const list = byIntent.get(key) ?? [];
    list.push({ text: p.text, asker: (p as unknown as { asker?: string | null }).asker ?? "" });
    byIntent.set(key, list);
  }
  // Specs re-derived from the stored seeds so the cells take the spec-era
  // paths (the server re-derives before every use; presence selects the
  // path). The alias read is the dictionary seed's cached call (bounded,
  // fails open to configured spellings).
  const aliasForms = await brandAliasForms([project.brand, ...project.competitors]).catch(
    () => ({}) as Record<string, string[]>
  );
  const cells = intents.map((i) => {
    const valueLine = i.stage === "pricing" && i.situation ? valueLines?.[i.situation] ?? null : null;
    const rec = dCellBy.get(`${cellKey(i)}|${norm(i.text)}`);
    const recParas = isObj(rec?.paraphrases) ? (rec!.paraphrases as Obj) : null;
    const offeredParas = Array.isArray(recParas?.offered)
      ? (recParas!.offered as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
    let spec = null;
    try {
      // Class cells (angle "class") persist without their class phrase -
      // they stay on the legacy path rather than derive a wrong design.
      if (i.angle !== "class") {
        spec = deriveCheckSpec(
          { stage: i.stage, angle: i.angle, text: i.text, concern: i.concern ?? null },
          project.brand, project.competitors, project.category, aliasForms
        );
      }
    } catch {
      spec = null;
    }
    const phrasings = (byIntent.get(i.id) ?? [])
      .filter((p) => norm(p.text) !== norm(i.text))
      // original = the confirmed text: these passed review at create and
      // must not re-enter the confirm-time check just for being reopened.
      .map((p) => ({ text: p.text, asker: p.asker, original: p.text }));
    return {
      stage: i.stage,
      layer: i.layer,
      situation: i.situation,
      angle: i.angle,
      mode: i.mode,
      qtype: (i as unknown as { qtype?: string | null }).qtype ?? null,
      concern: i.concern ?? null,
      ...(valueLine ? { valueLine } : {}),
      ...(spec ? { spec } : {}),
      text: i.text,
      // The confirmed seed is the review baseline (see phrasings above);
      // the engine's original offer survives in the stored record, which
      // the PUT merges back.
      original: i.text,
      phrasings,
      phrasedFor: i.text,
      // The engine's own seed from the record (seed.offered), falling back
      // to the confirmed text only when the record lacks it. The client's
      // cells merge keys on (design, engineSeed): a hand-edited seed is
      // kept through an edit-setup re-confirm exactly when the engine
      // still writes this seed - with engineSeed = the confirmed text the
      // engine's output never matched an edited cell and the edit was lost.
      engineSeed: str(isObj(rec?.seed) ? (rec!.seed as Obj).offered : null) ?? i.text,
      ...(offeredParas ? { phrasingsOffered: offeredParas } : {}),
    };
  });
  const [fit, journeyFit] = await Promise.all([
    reviewScenarioFit({
      brand: project.brand,
      category: project.category,
      scenarios: scenarios.map((s) => ({ label: s.label, description: s.description })),
      audience: project.audience ?? null,
      meta: { brand: project.brand, source: "edit_setup" },
    }).catch(() => null),
    reviewJourneyFit({
      brand: project.brand,
      category: project.category,
      base,
      meta: { brand: project.brand, source: "edit_setup" },
    }).catch(() => null),
  ]);
  // Rows rebuilt with their provenance: `first` is the room as the engine
  // first offered it, `original` the wording the decided row was measured
  // against, so buildSetupDecision recomputes the same `how` on the way
  // back out. A decided room is matched to its offer by the record, not
  // by label: an unchanged room by its exact text; a reworded, near-variant
  // or edited room (whose label moved) by order - the record writes both
  // lists from one row array, so the changed rooms take, in order, the
  // offers no unchanged room and no unticked label accounts for. Matching
  // by label sent every renamed room back with first = itself, which the
  // client reads as "offered".
  const offerOf = new Map<string, Room>();
  {
    const offTicked = new Set(
      Array.isArray(dRooms?.off) ? (dRooms!.off as unknown[]).filter((x): x is string => typeof x === "string") : []
    );
    const decidedList = dRooms && Array.isArray(dRooms.decided) ? dRooms.decided.filter(isObj) : [];
    const used = new Set<number>();
    const sameRoom = (a: Room, b: { label: string; description: string }) =>
      a.label.trim() === b.label.trim() && a.description.trim() === b.description.trim();
    // Unchanged rooms first: an exact offer.
    for (const r of decidedList) {
      const label = str(r.label);
      if (!label || (str(r.how) ?? "offered") !== "offered") continue;
      const j = offered.findIndex((o, k) => !used.has(k) && sameRoom(o, { label, description: str(r.description) ?? "" }));
      if (j >= 0) {
        used.add(j);
        offerOf.set(label, offered[j]);
      }
    }
    // Changed rooms in record order take the next unclaimed offer, skipping
    // offers whose label an unticked row still carries.
    let j = 0;
    for (const r of decidedList) {
      const label = str(r.label);
      const how = str(r.how) ?? "offered";
      if (!label || how === "offered" || how === "own") continue;
      while (j < offered.length && (used.has(j) || offTicked.has(offered[j].label))) j++;
      if (j < offered.length) {
        used.add(j);
        offerOf.set(label, offered[j]);
        j++;
      }
    }
  }
  const rows = scenarios.map((s) => {
    const how = decided.get(s.label)?.how ?? "offered";
    const cur = { label: s.label, description: s.description };
    // No offer found for a changed room: leave `first` unset rather than
    // claim the current wording was offered (an "edited" room then also
    // leaves `original` unset, so it reads back as edited, not offered).
    const first: { label: string; description: string } | undefined =
      offerOf.get(s.label) ?? (how === "offered" || how === "own" ? cur : undefined);
    const original = how === "reworded" || how === "near_variant" ? cur : first;
    return {
      label: s.label,
      description: s.description,
      journey: s.journey,
      suggested: how !== "own",
      on: true,
      original,
      first,
      ...(how === "near_variant" ? { variants: 1 } : {}),
    };
  });
  // Unticked rooms the record names come back unticked, when their text
  // is known from the offered list.
  const off = Array.isArray(dRooms?.off) ? (dRooms!.off as unknown[]).filter((x): x is string => typeof x === "string") : [];
  for (const label of off) {
    const r = offeredBy.get(label);
    if (!r || situations.includes(label)) continue;
    rows.push({ label: r.label, description: r.description, journey: null, suggested: true, on: false, original: r, first: r });
  }
  const moderatorsOffered = isObj(dBase?.offered) ? (dBase!.offered as Obj) : undefined;
  return {
    id: null,
    brand: project.brand,
    category: project.category,
    audience: project.audience,
    competitors: project.competitors,
    prompts: null,
    wizard: {
      mode: "grid",
      step: "prompts",
      studyName: project.name,
      engineSet: project.engine_set,
      grid: {
        step: "phrasings",
        fit,
        journeyFit,
        moderators: base,
        ...(moderatorsOffered ? { moderatorsOffered } : {}),
        stages: stages.map((s) => ({
          key: s.key, label: s.label, layer: s.layer, situational: s.situational,
          rivals: s.rivals, tag: s.tag, recommended: s.recommended,
          columns: s.columns, hint: s.hint, why: s.why,
        })),
        keptStages,
        scenarios: scenarios.map((s) => ({ label: s.label, description: s.description, journey: s.journey })),
        scenarioRows: rows,
        reserve: rooms(dRooms?.reserve),
        ...(stageRooms ? { stageRooms } : {}),
        ...(valueLines ? { valueLines } : {}),
        ...(valueRecommended ? { valueRecommended } : {}),
        ...(worryState
          ? { worries: worryState.worries, worryPool: worryState.worryPool, worryOffered: worryState.worryOffered }
          : {}),
        baselineCellCount: cells.length,
        cells,
      },
    },
  };
}

/**
 * Merge an edit-setup's incoming setup_decision over the stored one
 * (2026-10-24): the edit draft is rebuilt from the record, so its own
 * offered sides are reconstructions - replacing the record wholesale
 * nulled base.offered and made every seed "offered". The incoming record
 * owns every DECIDED side; the stored record keeps the offered history:
 * base.offered, the rooms ever offered (union), the worries pool, the
 * Value recommendations, and per seed its engine offer, provenance and
 * paraphrase offers wherever the incoming cell is the stored one carried
 * through unchanged by the engine. Same shape as buildSetupDecision.
 */
export function mergeSetupDecision(storedRaw: string | null, incoming: Obj): Obj {
  const stored = parseDecision(storedRaw);
  if (!stored) return incoming;
  const sBase = isObj(stored.base) ? stored.base : {};
  const iBase = isObj(incoming.base) ? incoming.base : {};
  const sRooms = isObj(stored.rooms) ? stored.rooms : {};
  const iRooms = isObj(incoming.rooms) ? incoming.rooms : {};
  const roomKey = (r: Room) => `${r.label.trim()}|${r.description.trim()}`;
  const offeredRooms = [...rooms(sRooms.offered)];
  const seenRooms = new Set(offeredRooms.map(roomKey));
  for (const r of rooms(iRooms.offered)) {
    if (!seenRooms.has(roomKey(r))) {
      seenRooms.add(roomKey(r));
      offeredRooms.push(r);
    }
  }
  const sValue = isObj(stored.valueLines) ? stored.valueLines : {};
  const iValue = isObj(incoming.valueLines) ? incoming.valueLines : {};
  const sWorries = isObj(stored.worries) ? stored.worries : null;
  const iWorries = isObj(incoming.worries) ? incoming.worries : null;

  const sCells = Array.isArray(stored.cells) ? stored.cells.filter(isObj) : [];
  const sCellBy = new Map<string, Obj>();
  const sCellByOffer = new Map<string, Obj>();
  for (const c of sCells) {
    const seed = isObj(c.seed) ? c.seed : null;
    const text = str(seed?.decided);
    if (text) sCellBy.set(`${cellKey(c)}|${norm(text)}`, c);
    const offer = str(seed?.offered);
    if (offer && !sCellByOffer.has(`${cellKey(c)}|${norm(offer)}`)) sCellByOffer.set(`${cellKey(c)}|${norm(offer)}`, c);
  }
  const cells = Array.isArray(incoming.cells)
    ? incoming.cells.filter(isObj).map((c) => {
        const seed = isObj(c.seed) ? c.seed : {};
        const offeredText = str(seed.offered);
        const decidedIn = str(seed.decided);
        // The cell came through the edit as the stored one when (1) its
        // decided text IS the stored decided text, (2) its offered seed is
        // the stored engine offer (the edit draft carries engineSeed =
        // the record's seed.offered, so an edited seed keeps its lineage),
        // or (3) its offered seed is the stored decided text (edit drafts
        // from before engineSeed set the baseline to the confirmed seed).
        // An engine redraw in the edit matches none and keeps its own
        // provenance.
        const k = cellKey(c);
        const prev =
          (decidedIn ? sCellBy.get(`${k}|${norm(decidedIn)}`) : undefined) ??
          (offeredText ? sCellByOffer.get(`${k}|${norm(offeredText)}`) ?? sCellBy.get(`${k}|${norm(offeredText)}`) : undefined);
        if (!prev) return c;
        const pSeed = isObj(prev.seed) ? prev.seed : {};
        const decidedText = str(seed.decided) ?? offeredText;
        const unchanged = norm(decidedText ?? "") === norm(str(pSeed.decided) ?? "");
        const pParas = isObj(prev.paraphrases) ? prev.paraphrases : {};
        const iParas = isObj(c.paraphrases) ? c.paraphrases : {};
        const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
        const paraOffered = [...new Set([...strings(pParas.offered), ...strings(iParas.offered)])];
        const pDecided = Array.isArray(pParas.decided) ? pParas.decided.filter(isObj) : [];
        const offerOf = new Map(pDecided.flatMap((d) => (str(d.text) && str(d.offered) ? [[norm(str(d.text)!), str(d.offered)!]] : [])));
        const decidedParas = (Array.isArray(iParas.decided) ? iParas.decided.filter(isObj) : []).map((d) => {
          const text = str(d.text) ?? "";
          const off = str(d.offered);
          // A paraphrase carried through the edit has offered === text;
          // its engine offer is the stored one.
          return off && norm(off) === norm(text) && offerOf.has(norm(text)) ? { ...d, offered: offerOf.get(norm(text)) } : d;
        });
        const decidedTexts = new Set(decidedParas.map((d) => norm(str(d.text) ?? "")));
        const decidedOffers = new Set(decidedParas.map((d) => norm(str(d.offered) ?? "")));
        return {
          ...c,
          seed: {
            ...seed,
            offered: str(pSeed.offered) ?? offeredText,
            how: unchanged ? (str(pSeed.how) ?? str(seed.how)) : "edited",
          },
          paraphrases: {
            ...iParas,
            offered: paraOffered,
            decided: decidedParas,
            dropped: paraOffered.filter((t) => !decidedTexts.has(norm(t)) && !decidedOffers.has(norm(t))),
            edited: decidedParas.filter((d) => str(d.offered) && norm(str(d.text) ?? "") !== norm(str(d.offered)!)).length,
          },
        };
      })
    : incoming.cells;

  // THE MERGE RULE, per top-level field: the incoming record owns every
  // DECIDED side whenever it carries the field at all (null included). The
  // stored record (a) supplies a whole field only when the incoming record
  // lacks it entirely, and (b) inside a present field fills only the
  // OFFERED-history subfields the incoming one leaves empty. A spread of
  // the stored record under the incoming one would resurrect stored
  // decided values (worry picks came back after an edit removed them).
  const has = (k: string) => Object.prototype.hasOwnProperty.call(incoming, k);
  const out: Obj = { ...stored, ...incoming };
  out.base = has("base")
    ? isObj(incoming.base)
      ? { ...iBase, offered: iBase.offered ?? sBase.offered ?? null }
      : incoming.base
    : stored.base;
  out.rooms = has("rooms")
    ? isObj(incoming.rooms)
      ? {
          ...iRooms,
          offered: offeredRooms,
          reserve: rooms(iRooms.reserve).length > 0 ? iRooms.reserve : (sRooms.reserve ?? []),
        }
      : incoming.rooms
    : stored.rooms;
  out.valueLines = has("valueLines")
    ? isObj(incoming.valueLines)
      ? { ...iValue, recommended: iValue.recommended ?? sValue.recommended ?? null }
      : incoming.valueLines
    : stored.valueLines;
  // Worries: decided is always the incoming picks. A present-but-null
  // incoming (no worries gate in this walk) keeps the stored POOL as
  // history with no picks - never the stored picks.
  const sPool = Array.isArray(sWorries?.offered) && (sWorries!.offered as unknown[]).length > 0 ? sWorries!.offered : null;
  out.worries = has("worries")
    ? iWorries
      ? { ...iWorries, offered: sPool ?? iWorries.offered }
      : sPool
        ? { offered: sPool, decided: [] }
        : incoming.worries
    : stored.worries;
  out.cells = has("cells") ? cells : stored.cells;
  return out;
}
