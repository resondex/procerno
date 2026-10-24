import { store } from "@/lib/store";
import { tagCosts } from "@/lib/cost_log";
import {
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

const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

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

/** The cell identity the decision record and the stored intents share. */
const cellKey = (c: { stage?: unknown; situation?: unknown; angle?: unknown; concern?: unknown }) =>
  `${str(c.stage) ?? ""}|${str(c.situation) ?? ""}|${str(c.angle) ?? ""}|${str(c.concern) ?? ""}`;

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
    const checked = ModeratorsShape.safeParse(raw);
    // A read stored before validation (create accepted any record) still
    // opens - the wizard's own calls validate it from here on.
    base = (checked.success ? checked.data : raw) as Moderators;
    if (!isObj(base)) return null;
  } catch {
    return null;
  }
  const [prompts, decisionRaw] = await Promise.all([
    store.listPrompts(id),
    store.getSetupDecision(id).catch(() => null),
  ]);
  const decision = parseDecision(decisionRaw);
  const dRooms = isObj(decision?.rooms) ? (decision!.rooms as Obj) : null;
  const dStages = isObj(decision?.stages) ? (decision!.stages as Obj) : null;
  const dValue = isObj(decision?.valueLines) ? (decision!.valueLines as Obj) : null;
  const dWorries = isObj(decision?.worries) ? (decision!.worries as Obj) : null;
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

  // Worries: the picks ARE the stored worry cells (stage + concern); the
  // pool comes back from the record so the gate never redraws (a redraw
  // rewords the worries and orphans the picks). The record keeps no
  // per-worry stance list, so a worry's stances are rebuilt from its
  // natural stance, its plan and the stances it was picked at.
  const worryStages = new Set<string>(WORRY_STANCE_STAGES);
  const worryPicks = intents
    .filter((i) => i.concern && worryStages.has(i.stage))
    .map((i) => ({ concern: i.concern as string, stage: i.stage }));
  const worryPool = Array.isArray(dWorries?.offered)
    ? (dWorries!.offered as unknown[]).filter(isObj).flatMap((w) => {
        const worry = str(w.worry);
        if (!worry) return [];
        const recommended = str(w.recommended) ?? "";
        const plan = Array.isArray(w.plan) ? w.plan.filter((x): x is string => typeof x === "string") : [];
        const picked = worryPicks.filter((p) => p.concern === worry).map((p) => p.stage);
        const stances = [...new Set([recommended, ...plan, ...picked].filter(Boolean))];
        return [{ worry, detail: str(w.detail) ?? "", stances, recommended, recommend: plan }];
      })
    : null;
  const worryEra = worryPool !== null || worryPicks.length > 0;

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
  // first offered it (matched by label), `original` the wording the
  // decided row was measured against, so buildSetupDecision recomputes the
  // same `how` on the way back out.
  const rows = scenarios.map((s) => {
    const how = decided.get(s.label)?.how ?? "offered";
    const cur = { label: s.label, description: s.description };
    const first = offeredBy.get(s.label) ?? cur;
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
        ...(worryEra ? { worries: worryPicks } : {}),
        ...(worryPool ? { worryPool, worryOffered: [...new Set(worryPool.flatMap((w) => w.stances))] } : {}),
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
  for (const c of sCells) {
    const seed = isObj(c.seed) ? c.seed : null;
    const text = str(seed?.decided);
    if (text) sCellBy.set(`${cellKey(c)}|${norm(text)}`, c);
  }
  const cells = Array.isArray(incoming.cells)
    ? incoming.cells.filter(isObj).map((c) => {
        const seed = isObj(c.seed) ? c.seed : {};
        const offeredText = str(seed.offered);
        // The cell came through the edit as the stored one when its
        // offered baseline IS the stored decided text (the edit draft sets
        // original = the confirmed seed); an engine redraw in the edit has
        // a different baseline and keeps its own provenance.
        const prev = offeredText ? sCellBy.get(`${cellKey(c)}|${norm(offeredText)}`) : undefined;
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

  return {
    ...stored,
    ...incoming,
    base: { ...iBase, offered: iBase.offered ?? sBase.offered ?? null },
    rooms: {
      ...iRooms,
      offered: offeredRooms,
      reserve: rooms(iRooms.reserve).length > 0 ? iRooms.reserve : (sRooms.reserve ?? []),
    },
    valueLines: { ...iValue, recommended: iValue.recommended ?? sValue.recommended ?? null },
    worries: iWorries
      ? { ...iWorries, offered: Array.isArray(sWorries?.offered) && (sWorries!.offered as unknown[]).length > 0 ? sWorries!.offered : iWorries.offered }
      : sWorries,
    cells,
  };
}
