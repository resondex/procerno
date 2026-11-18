/* eslint-disable @typescript-eslint/no-explicit-any -- a harness over the served payloads */
/**
 * The fact layer, step 2 (FACT_LAYER_DESIGN_2026-11-17.md): proves layers 1 and 2 (src/lib/engine/facts/) on the
 * snapshot of live, beside the existing code. For each tracker:
 *
 *  - every stat in the stat registry (every number a card or By rival page draws) that corresponds to a measure in
 *    the measure book is computed as a fact and compared with the stat: counts (k, n) and printed text. Each
 *    compared stat is
 *      equal                 - the fact reproduces it exactly;
 *      explained by a ruling - the fact differs, and the SAME measure computed under today's rule (the rule the
 *                              ruling replaces) reproduces the card exactly - e.g. ruling 7: the all-buyers What to
 *                              buy card, recomputed on today's four-type pool, must equal the card;
 *      a known fault or a known conflict with no ruling yet (named, from ENGINE_INVENTORY_2026-11-17.md) - the
 *                              alternative that reproduces it is stated;
 *      unexplained           - a failure (listed);
 *  - which card rows a card lists is a selection (layer 3, not built): the harness picks the row's subject from the
 *    card (a condition row's units by its label, a weighs column's slice by the card kind, a rival's own card), and
 *    the row's NUMBER must still be a fact;
 *  - stats with counts that no measure covers are counted by why and path prefix: the average competitor (a
 *    selection, layer 3) and product names (no product grouping in layer 1 yet); anything else is "other";
 *  - numbers inside sentences with no counts are not facts: each is checked against the covered facts' printed
 *    numbers on the same card (equal text = it can cite that fact), and the rest are listed by path prefix - the
 *    statements layer's input;
 *  - a sample of the Data page's measures (workbench.ts facts + measures.ts definitions) is recomputed from its own
 *    fact table and compared with the same fact.
 *
 * Env: FACT_DUMP=<file> writes every uncovered stat (JSON lines); FACT_FAIL=<file> writes every unexplained one.
 *
 * Exits non-zero on any unexplained difference. Fixture only, no model calls, writes nothing:
 *   SQLITE_PATH=data/dashboard_fixture.db VIEW_CACHE=off npx tsx scripts/fact_layer_harness.mts
 */
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = process.cwd() + "/data/dashboard_fixture.db";
process.env.VIEW_CACHE = "off";
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";

const ROOT = process.cwd();
const { store } = await import(ROOT + "/src/lib/store/index.ts");
const { loadViewData } = await import(ROOT + "/src/lib/engine/view_data.ts");
const { sharedAnalysisMap } = await import(ROOT + "/src/lib/engine/analysis_map.ts");
const { buildStatRegistry } = await import(ROOT + "/src/lib/engine/stat_registry.ts");
const { cachedRunRevision } = await import(ROOT + "/src/lib/engine/run_revision.ts");
const { buildAnswerFacts } = await import(ROOT + "/src/lib/engine/facts/answer_facts.ts");
const { factBook, WHAT_TO_BUY_ALL } = await import(ROOT + "/src/lib/engine/facts/fact.ts");
const { printWhole } = await import(ROOT + "/src/lib/engine/facts/measure_book.ts");
const { computeWorkbench } = await import(ROOT + "/src/lib/engine/workbench.ts");
const { MEASURE_BY_ID: DATA_MEASURES } = await import(ROOT + "/src/lib/engine/measures.ts");
const { buildResolver } = await import(ROOT + "/src/lib/engine/brand_resolve.ts");
const { attachConditions } = await import(ROOT + "/src/lib/engine/facts/conditions.ts");
const { condRowLabel } = await import(ROOT + "/src/lib/engine/panel_text.ts");
const { isDefaultCondition } = await import(ROOT + "/src/lib/engine/condition_groups.ts");
const { cardKey } = await import(ROOT + "/src/lib/engine/facts/measure_book.ts");
const DUMP = process.env.FACT_DUMP ?? "";

type Scope = import("../src/lib/engine/facts/fact.ts").Scope;
type QT = import("../src/lib/engine/facts/answer_facts.ts").QuestionType;

const norm = (s: string) => s.trim().toLowerCase();
const unseg = (s: string) => s.replace(/∕/g, "/");

/** Today's four-type What to buy pool (the rule ruling 7 replaces). */
const WHAT_TO_BUY_TODAY: Scope = { types: ["discovery", "use_case", "social_validation", "premium_worth"] };

/** A comparison: the primary fact, then alternatives tried in order when it differs. */
interface Alt {
  label: string;
  /** The ruling's measured moves (RULING_MOVES_2026-11-17.md raw data) this explanation must agree with: "exact" =
   * the move's "after" counts must equal the fact; "listed" = the stat must be listed as moved. */
  moves?: { ruling: string; check: "exact" | "listed" };
  kind: "ruling" | "known";
  /** Compute the alternative's counts. */
  calc: () => { k: number; n: number };
}
interface Spec {
  m: string;
  s: string;
  scope: Scope;
  alts?: Alt[];
}
type Mapped = { spec: Spec } | { group: string };

/* RULING_MOVES raw data (measured 2026-11-17): ruling -> tracker -> stat path -> before / after counts. */
const MOVES_PATH = `${process.env.HOME}/Documents/procerno_eval/engine_inventory_2026-11-17/rulings/MOVES_raw.json`;
const fsMod = await import("node:fs");
const movesLoaded = fsMod.existsSync(MOVES_PATH);
type KN = { k: number; n: number };
const parseKN = (x: string | undefined): KN | undefined => {
  const m = x ? /\((\d+)\/(\d+)\)/.exec(x) : null;
  return m ? { k: Number(m[1]), n: Number(m[2]) } : undefined;
};
const MOVES = new Map<string, { kind: string; before: KN; after?: KN; raw: any }>();
if (movesLoaded) {
  const raw = JSON.parse(fsMod.readFileSync(MOVES_PATH, "utf8"));
  for (const [ruling, byBrand] of Object.entries<any>(raw))
    for (const [b, list] of Object.entries<any>(byBrand)) {
      if (!Array.isArray(list)) continue;
      for (const x of list) {
        if (x.screen !== "card" && x.screen !== "byrival") continue;
        const before = parseKN(x.before);
        if (!before && x.kind === "changed") continue;
        MOVES.set(`${ruling}|${b}|${x.path}`, { kind: x.kind, before: before ?? { k: -1, n: -1 }, after: parseKN(x.after), raw: x });
      }
    }
}
const movesOf = (ruling: string, b: string, path: string) => MOVES.get(`${ruling}|${b}|${path}`);
let movesConfirmed = 0;
/** Card stats compared, per measure (all trackers). */
const byMeasure = new Map<string, number>();

const totals = { compared: 0, equal: 0, explained: new Map<string, number>(), unexplained: 0, notCovered: 0, notCoveredBy: new Map<string, number>(), sentMatched: 0, sentUnmatched: 0, sentByPrefix: new Map<string, number>() };
const failures: string[] = [];
const dumpRows: string[] = [];
let crossChecked = 0;
let crossEqual = 0;
let crossKnown = 0;

for (const project of (await store.listProjects()).filter((p: any) => !p.archived_at)) {
  const run = (await store.listRuns(project.id))[0];
  const data: any = await loadViewData(run, project, { setupDecision: true, judge: true });
  if (!data) continue;
  data.revision = await cachedRunRevision(run.id);
  const { view: map } = await sharedAnalysisMap(data, {});
  const reg = buildStatRegistry(map);
  const set = buildAnswerFacts(data);
  const { themed } = await attachConditions(set, data);
  const book = factBook(set);
  const T = set.target.key;
  const brand = project.brand as string;

  /* ---------- helpers: names, scopes ---------- */
  const keyOf = (name: string): string => (name === "you" || name === "You" || name === brand ? "you" : set.resolve(name).key);
  const kindOf = (cellId: string): string | undefined => map.positions[cellId]?.panel?.kind;
  const factsOfType = (types: QT[]) => set.facts.filter((f) => types.includes(f.type));
  const situationByKey = (types: QT[], key: string): string | null | undefined => {
    if (key === "all") return undefined;
    if (key === "general") return null;
    const hit = factsOfType(types).find((f) => f.situation !== null && norm(f.situation) === key);
    return hit ? hit.situation : "__no_such_situation__";
  };
  const situationByLabel = (types: QT[], label: string): string => {
    const sits = [...new Set(factsOfType(types).map((f) => f.situation).filter((s): s is string => !!s))].sort((a, b) => b.length - a.length);
    return sits.find((s) => label === s || label.startsWith(`${s} - `)) ?? "__no_such_situation__";
  };
  const worryByKey = (types: QT[], key: string): string => factsOfType(types).find((f) => norm(f.worry ?? "A worry") === key)?.worry ?? "__no_such_worry__";
  const ROW_TYPES: Record<string, QT[]> = {
    open: ["discovery", "use_case"],
    social: ["social_validation"],
    premium: ["premium_worth"],
    awareness: ["problem_recognition"],
    explainer: ["category_education"],
    value: ["pricing"],
    criteria: ["criteria"],
    leavers: ["switching"],
    buyers: ["objections"],
    customers: ["churn_triggers", "renewal"],
    hold: ["looking_around"],
    repertoire: ["repertoire"],
  };
  const SETTLED_TYPE: Record<string, QT> = { "business case": "business_case", expansion: "expansion", ecosystem: "ecosystem", advocacy: "advocacy" };
  /** A Map cell's scope from its id (band:row:key), and today's scope where ruling 7 changes it. */
  const cellScope = (cellId: string): { scope: Scope; today?: Scope } | null => {
    const [, row, ...rest] = cellId.split(":");
    const key = rest.join(":");
    if (row === "open" && key === "all") return { scope: WHAT_TO_BUY_ALL, today: WHAT_TO_BUY_TODAY };
    if (row === "h2h") {
      if (key === "all") return { scope: { types: ["comparison_entity"] } };
      if (key.startsWith("class-")) {
        const f = factsOfType(["comparison_class"]).find((x) => x.rival && norm(x.rival.name) === key.slice(6));
        return { scope: { types: ["comparison_class"], rival: f?.rival?.key ?? "__none__" } };
      }
      const f = factsOfType(["comparison_entity"]).find((x) => norm(x.angle ?? "") === key);
      return { scope: { types: ["comparison_entity"], rival: f?.rival?.key ?? "__none__" } };
    }
    if (row === "leavers") {
      if (key === "all") return { scope: { types: ["switching"] } };
      if (key === "generic") return { scope: { types: ["switching"], rival: "generic" } };
      const f = factsOfType(["switching"]).find((x) => norm(x.angle ?? "") === key);
      return { scope: { types: ["switching"], rival: f?.rival?.key ?? "__none__" } };
    }
    if (row === "settled") {
      if (key === "all") return { scope: { types: ["business_case", "expansion", "ecosystem", "advocacy"] } };
      return SETTLED_TYPE[key] ? { scope: { types: [SETTLED_TYPE[key]] } } : null;
    }
    if (row === "buyers" || row === "customers") {
      const types = ROW_TYPES[row];
      if (key === "all") return { scope: { types } };
      const [k, stage] = key.split("|");
      return { scope: { types: stage ? [stage as QT] : types, worry: worryByKey(stage ? [stage as QT] : types, k) } };
    }
    const types = ROW_TYPES[row];
    if (!types) return null;
    const situation = situationByKey(types, key);
    return { scope: situation === undefined ? { types } : { types, situation } };
  };
  /** The row's All cell scope (the cards' "usual"). */
  const rowAllScope = (cellId: string) => {
    const [band, row] = cellId.split(":");
    return cellScope(`${band}:${row}:all`);
  };

  /* ---------- alternatives: today's rules that a ruling replaces ---------- */
  const countWith = (scope: Scope, base: (f: any) => boolean, hit: (f: any) => boolean) => {
    let k = 0;
    let n = 0;
    for (const f of book.rows(scope)) {
      if (!base(f)) continue;
      n++;
      if (hit(f)) k++;
    }
    return { k, n };
  };
  const ruling7 = (m: string, s: string, today: Scope | undefined): Alt[] =>
    today ? [{ label: "ruling 7 (all-buyers What to buy = discovery + use case; today's card pools four types)", kind: "ruling", moves: { ruling: "R7", check: "exact" }, calc: () => book.fact(m, s, today) }] : [];
  /** Ruling 6: recommended counts the pick; today's mention-only count (recommendsOf) leaves it out. */
  const ruling6 = (s: string, scope: Scope): Alt => {
    const key = s === "you" ? T : s;
    return { label: "ruling 6 (a pick counts as recommended; today's count leaves the pick out)", kind: "ruling", calc: () => countWith(scope, () => true, (f) => f.brands.some((b: any) => b.key === key && b.framedRecommended && b.bucket !== "outside_category")) };
  };

  /* ---------- the mapping: a registry stat to a fact ---------- */
  const SEG: Record<string, Record<string, string>> = {
    buyer_worry: { proceed: "go_ahead", avoid: "steer_clear", none: "buyer_no_side" },
    customer_worry: { keep: "stay", leave: "leave", none: "customer_no_side" },
    looking_around: { keep: "stay", leave: "leave", none: "customer_no_side" },
  };
  const segMeasure = (kind: string, step: string, seg: string): string | undefined => {
    if (step === "verdict") return SEG[kind]?.[seg];
    if (step === "worth") return ({ yes: "worth_yes", depends: "worth_depends", no: "worth_no" } as any)[seg];
    if (step === "instead") return ({ rival: "instead_rival", own: "instead_own", nowhere: "instead_nowhere" } as any)[seg];
    if (step === "tier") return ({ premium: "tier_premium", basic: "tier_basic", balanced: "tier_balanced" } as any)[seg];
    if (step === "relationship") return ({ strengthens: "relationship_strengthens", steady: "relationship_neutral", weakens: "relationship_weakens" } as any)[seg];
    if (step === "strength") return kind === "critic" ? ({ strong: "case_strong", partial: "case_partial", concedes: "case_concedes" } as any)[seg] : ({ strong: "case_strong", hedged: "case_hedged", undermined: "case_undermined" } as any)[seg];
    if (step === "stance") return ({ backs: "growth_backs", neutral: "growth_neutral", redirects: "growth_redirects" } as any)[seg];
    if (step === "premise") return ({ rebuts: "disagrees", mixed: "partly_agrees", confirms: "agrees" } as any)[seg];
    return undefined;
  };
  // Codebook codes by their lowercase display label (codeName only changes case).
  const codes = new Map<string, string>();
  for (const f of set.facts) for (const a of f.args ?? []) codes.set(norm(a), a);
  const codeOf = (label: string) => codes.get(norm(label));
  const VENDOR_SECTION: [RegExp, string, string][] = [
    [/^Which AI companies agree most$/, "agrees", "ai"],
    [/^Which AI companies point to /, "routed_category", "ai"],
    [/^Which AI companies name a brand$/, "names_any_brand", "ai"],
    [/^Which AI companies name you$/, "named_when_any", "you"],
    [/^Which AI companies back it most$/, "growth_backs", "ai"],
    [/^Which AI companies give a (strong answer|confident case) most$/, "case_strong", "ai"],
    [/^Which AI companies side with the critic most$/, "agrees", "ai"],
    [/^Which AI companies strengthen it least$/, "relationship_strengthens", "ai"],
  ];
  const SETTLED_LABEL: Record<string, QT> = { "business case": "business_case", expansion: "expansion", ecosystem: "ecosystem", "what to use alongside you": "ecosystem", advocacy: "advocacy", "answering a critic": "advocacy" };

  /* ---------- conditions: a card row -> the units it counts (layer 3 picks the rows; the row's number is a fact) ---------- */
  const COND_SOFT = new Set(["a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "with", "is", "are", "be", "they", "their", "them", "theirs", "often", "frequently", "frequent", "regularly", "regular", "usually", "always", "mostly", "really", "very", "lot", "lots", "much", "many", "more", "most", "heavily", "heavy", "plenty", "want", "wants", "prefer", "prefers", "need", "needs", "like", "likes", "if", "when"]);
  const condKey = (l: string) => condRowLabel(l).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const condCore = (l: string) => [...new Set(condKey(l).split(" ").filter((w: string) => w && !COND_SOFT.has(w)).map((w: string) => w.slice(0, 5)))].sort().join(" ");
  type Flavor = "themed" | "map" | "tier";
  const flavorOf = (cellId: string, rivalPart = false): Flavor => (kindOf(cellId) === "premium" && !rivalPart ? "tier" : themed ? "themed" : "map");
  const unitIdx = new Map<string, Map<string, Set<string>>>();
  /** The units a card's rows on one side are built from in a scope, by the row's label key (the cards' mergeSame). */
  const unitsBy = (scope: Scope, side: "toward" | "away", flavor: Flavor): Map<string, Set<string>> => {
    const k = `${JSON.stringify(scope)}|${side}|${flavor}`;
    let out = unitIdx.get(k);
    if (out) return out;
    out = new Map();
    const ok = (u: string) =>
      flavor === "themed" ? u.startsWith(`t:${side}:`) || (side === "away" && u.startsWith("g:elsewhere:")) : u.startsWith(`${flavor === "map" ? "m" : "p"}:${side}:`);
    const label = new Map<string, string>();
    const said = new Map<string, Map<string, number>>();
    for (const f of book.rows(scope))
      for (const c of f.conds ?? []) {
        if (!ok(c.unit)) continue;
        if (flavor === "themed") label.set(c.unit, c.label);
        else {
          const m = said.get(c.unit) ?? new Map<string, number>();
          m.set(c.said, (m.get(c.said) ?? 0) + 1);
          said.set(c.unit, m);
        }
      }
    // The Map's groups are named by their most stated wording among the cell's answers (groupsOf).
    for (const [u, m] of said) label.set(u, [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length || (x[0] < y[0] ? -1 : 1))[0][0]);
    for (const [u, l] of label) {
      if (isDefaultCondition(l)) continue;
      const key = condKey(l);
      const set2 = out.get(key) ?? new Set<string>();
      set2.add(u);
      out.set(key, set2);
    }
    unitIdx.set(k, out);
    return out;
  };
  const condSubject = (head: string, units: Set<string>, opts: { to?: string; card?: string; only?: string } = {}) =>
    `${head}/cond:${[...units].sort().join("+")}${opts.to ? `>to:${opts.to}` : ""}${opts.card ? `>card:${opts.card}` : ""}${opts.only ? `@${opts.only}` : ""}`;
  /** Today's pooled What to buy card (ruling 7): the same condition counted on the four-type pool, unchecked. */
  const ruling7c = (m: string, s: string, today: Scope | undefined): Alt[] =>
    today ? [{ label: "ruling 7 (all-buyers What to buy = discovery + use case; today's card pools four types)", kind: "ruling", moves: { ruling: "R7", check: "exact" }, calc: () => book.countUnchecked(m, s, today) }] : [];
  const h2hCellOf = (rivalKey: string, row: "h2h" | "leavers") =>
    Object.keys(map.positions).find((id) => id.startsWith(`fights:${row}:`) && !id.endsWith(":all") && cellScope(id)?.scope.rival === rivalKey);
  /**
   * The both-ways pairs of a cell (analysis_map.ts bothWaysPairs, the selection behind the "also" figure of a row
   * no other-side row matches): a Map group stated on both sides at similar rates, merged when both halves fall in
   * the same reason themes. Only the pairing is rebuilt here (a selection, layer 3); the figure is a fact over the
   * paired Map units.
   */
  const NEGATED = /\b(?:not|no|never|without|rarely|seldom|hardly|hate|avoid|lack|won't|can't|cannot)\b|n't\b|n’t\b/i;
  const pairMemo = new Map<string, { tt: number | null; at: number | null; t: Set<string>; a: Set<string> }[]>();
  const pairsOf = (scope: Scope) => {
    const key = JSON.stringify(scope);
    const hit = pairMemo.get(key);
    if (hit) return hit;
    const rows = book.rows(scope);
    const bearing = rows.filter((f: any) => f.conds !== null).length;
    type G = { unit: string; h: string; n: number; label: string; said: Map<string, number>; answers: Map<string, string> };
    const sides: Record<"toward" | "away", Map<string, G>> = { toward: new Map(), away: new Map() };
    for (const f of rows)
      for (const c of f.conds ?? []) {
        if (c.grouping !== "map") continue;
        const h = c.unit.split(":")[2];
        const g = sides[c.side as "toward" | "away"].get(h) ?? { unit: c.unit, h, n: 0, label: "", said: new Map(), answers: new Map() };
        g.n++;
        g.said.set(c.said, (g.said.get(c.said) ?? 0) + 1);
        g.answers.set(f.responseId, c.said);
        sides[c.side as "toward" | "away"].set(h, g);
      }
    for (const m of Object.values(sides)) for (const g of m.values()) g.label = [...g.said.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length || (x[0] < y[0] ? -1 : 1))[0][0];
    // (answer, wording) -> its theme index, per side (the Map's themeOfAnswers index).
    const themeIdx = { toward: new Map<string, number>(), away: new Map<string, number>() };
    for (const f of set.facts)
      for (const c of f.conds ?? [])
        if (c.grouping === "group" && c.theme) {
          const [, side, n] = c.theme.split(":");
          themeIdx[side as "toward" | "away"].set(`${f.responseId}\u0000${c.said}`, Number(n));
        }
    const themeOf = (side: "toward" | "away", g: G): number | null => {
      if (!themed) return null;
      const tally = new Map<number, number>();
      for (const [rid, w] of g.answers) {
        const t = themeIdx[side].get(`${rid}\u0000${w}`);
        if (t !== undefined) tally.set(t, (tally.get(t) ?? 0) + 1);
      }
      let best: number | null = null;
      for (const [t, k] of tally) if (best === null || k > tally.get(best)! || (k === tally.get(best)! && t < best)) best = t;
      return best;
    };
    const pairs = [...sides.toward.values()]
      .filter((t) => !isDefaultCondition(t.label))
      .flatMap((t) => {
        const a = sides.away.get(t.h);
        if (!a || isDefaultCondition(a.label)) return [];
        if (Math.min(t.n, a.n) < Math.max(3, 0.05 * bearing) || Math.min(t.n, a.n) < 0.5 * Math.max(t.n, a.n)) return [];
        if (NEGATED.test(t.label) !== NEGATED.test(a.label)) return [];
        return [{ t, a }];
      })
      .sort((x, y) => y.t.n + y.a.n - (x.t.n + x.a.n) || x.t.label.localeCompare(y.t.label));
    const merged: { tt: number | null; at: number | null; t: Set<string>; a: Set<string> }[] = [];
    for (const p of pairs) {
      const tt = themeOf("toward", p.t);
      const at = themeOf("away", p.a);
      const m = tt !== null && at !== null ? merged.find((x) => x.tt === tt && x.at === at) : undefined;
      if (m) {
        m.t.add(p.t.unit);
        m.a.add(p.a.unit);
      } else merged.push({ tt, at, t: new Set([p.t.unit]), a: new Set([p.a.unit]) });
    }
    pairMemo.set(key, merged);
    return merged;
  };

  /**
   * One condition stat on a card. `cellId` = the cell whose answers count; `R` = the rival whose rows count only
   * answers sending the buyer to it (a rival's own card, a By rival page); `towardFromCell` = the toward rows are the
   * cell card's own (the rival cards reuse them); `dest` / `prefix` = where the card's other rows sit (for "also").
   */
  const mapCond = (cellId: string, R: string | null, towardFromCell: boolean, side: "toward" | "away", text: string, what: string[], dest: string, prefix: string, g: string): Mapped => {
    // A rival's own card reuses the cell card's toward rows - except on Premium vs basic, whose card draws the tier
    // rows while its rival cards keep the brand-sided rows (panel_build popularPanel / premiumPanel).
    const premiumRival = kindOf(cellId) === "premium" && dest.includes("/rival:");
    if (side === "toward" && towardFromCell && !premiumRival) return mapCond(cellId, null, false, side, text, what, `cell:${cellId}`, "conditions", g);
    const cs = cellScope(cellId);
    if (!cs) return { group: `${g} (no scope)` };
    const { scope, today } = cs;
    const kind = kindOf(cellId);
    const flavor = flavorOf(cellId, premiumRival);
    const other = side === "toward" ? "away" : "toward";
    // A row's label: its units' own (the cards' mergeSame), or - when the same reason is stated on both sides under
    // near-identical names - the other side's larger name (the cards' am37 relabel): then its units are this side's
    // units with the same content words (condCore).
    const byCore = (sc: Scope, sd: "toward" | "away") => {
      const out = new Set<string>();
      for (const [lk, us] of unitsBy(sc, sd, flavor)) if (condCore(lk) && condCore(lk) === condCore(text)) for (const u of us) out.add(u);
      return out.size ? out : undefined;
    };
    const unitsIn = (sc: Scope) => {
      const u = unitsBy(sc, side, flavor).get(condKey(text)) ?? byCore(sc, side);
      // The alongside card moves an away row whose products are mostly the tracker's own into the toward column.
      return u ?? (kind === "alongside" && side === "toward" ? unitsBy(sc, other, flavor).get(condKey(text)) : undefined);
    };
    const units = unitsIn(scope);
    if (!units) return { group: `${g} (no unit found for the row)` };
    // Under today's pooled card (ruling 7) the row's units are the ones its own answers carry under that label.
    const unitsToday = today ? unitsIn(today) ?? units : units;
    const exceptionCell = !R && kind === "h2h" && !cellId.endsWith(":all") && !!(map.positions[cellId] as any)?.exception;
    const exception = side === "toward" && exceptionCell;
    const opts = { ...(R && side === "away" ? { to: keyOf(R) } : {}), ...(exception ? { only: "pick:rival" } : {}) };
    const [w0, w1] = what;
    // Fault found here (not fixed): on a card pooling several buying situations, a theme statement's destinations
    // also take the answer's OTHER wordings whose group falls in that theme only for another buyer (panel_build
    // statementOf merges every group of the theme across the cell's questions). Reproduced: the destinations
    // re-merged that way, on today's pooled card (ruling 7).
    const faultAlt = (mk: "share" | "youPicked" | "dest", brandKey?: string): Alt[] => {
      if (flavor !== "themed" || !today || (mk !== "dest" && !opts.to)) return [];
      return [
        {
          label: "ruling 7 + a fault found here (a pooled card's theme statement takes destinations from the answer's wordings that fall in the theme only for another buyer)",
          kind: "known",
          calc: () => {
            const rows = book.rows(today);
            const G = new Set<string>();
            for (const f of rows) for (const c of f.conds ?? []) if (unitsToday.has(c.unit)) for (const gid of c.groups) G.add(gid);
            const cardTo = (f: any) => new Set<string>((f.conds ?? []).filter((c: any) => c.unit.startsWith("g:") && G.has(c.unit.slice(2))).flatMap((c: any) => c.toKeys));
            const st = (f: any) => (f.conds ?? []).some((c: any) => unitsToday.has(c.unit));
            let k = 0;
            let n = 0;
            for (const f of rows) {
              if (mk === "share") {
                n++;
                if (st(f) && cardTo(f).has(opts.to!)) k++;
              } else if (mk === "youPicked") {
                if (!(st(f) && cardTo(f).has(opts.to!))) continue;
                n++;
                if (f.pick.state !== "none" && f.pick.key === T) k++;
              } else {
                if (!st(f)) continue;
                const to = cardTo(f);
                if (!to.size) continue;
                n++;
                if (to.has(brandKey!)) k++;
              }
            }
            return { k, n };
          },
        },
      ];
    };
    if (w0 === "share") return { spec: { m: "cond_share", s: condSubject("ai", units, opts), scope, alts: [...ruling7c("cond_share", condSubject("ai", unitsToday, opts), today), ...faultAlt("share")] } };
    if (w0 === "youPicked") return { spec: { m: "cond_you_picked", s: condSubject("ai", units, opts), scope, alts: [...ruling7c("cond_you_picked", condSubject("ai", unitsToday, opts), today), ...faultAlt("youPicked")] } };
    if (w0 === "to") {
      if (kind === "alongside") return { spec: { m: "cond_card", s: condSubject("ai", units, { ...opts, card: cardKey(unseg(w1)) }), scope } };
      const sb = condSubject(keyOf(unseg(w1)), units, opts);
      return { spec: { m: "cond_dest", s: sb, scope, alts: [...ruling7c("cond_dest", condSubject(keyOf(unseg(w1)), unitsToday, opts), today), ...faultAlt("dest", keyOf(unseg(w1)))] } };
    }
    if (w0 === "also") {
      // The other side's own row on this card, when one says the same (the cards' condCore match).
      // A rival card's toward rows are the cell card's own: look for the twin there (its fold shows every row).
      const pre = other === "toward" && towardFromCell && !premiumRival ? `cell:${cellId}::conditions/toward/` : `${dest}::${prefix}/${other}/`;
      const twin = reg.all().find((x: any) => x.id.startsWith(pre) && x.id.endsWith("/share") && x.id.slice(pre.length).split("/").length === 2 && condCore(unseg(x.id.slice(pre.length).split("/")[0])) === condCore(text));
      if (twin) return mapCond(cellId, R, towardFromCell, other, unseg(twin.id.slice(pre.length).split("/")[0]), ["share"], dest, prefix, g);
      // Else the row's both-ways pair (themed rows: the pair whose half on this side falls in the row's theme).
      if (flavor === "themed") {
        const themes = [...units].filter((u) => u.startsWith(`t:${side}:`)).map((u) => Number(u.split(":")[2]));
        for (const T0 of themes) {
          const pr = pairsOf(scope).find((x) => (side === "toward" ? x.tt : x.at) === T0);
          if (!pr) continue;
          const pu = side === "toward" ? pr.a : pr.t;
          const prT = today ? pairsOf(today).find((x) => (side === "toward" ? x.tt : x.at) === T0) : undefined;
          const puT = prT ? (side === "toward" ? prT.a : prT.t) : pu;
          // A row of the lost-with-an-exception card counts the other side only on answers that pick the rival.
          const o2 = side === "away" && kind === "h2h" && !cellId.endsWith(":all") && !!(map.positions[cellId] as any)?.exception ? { only: "pick:rival" } : {};
          return { spec: { m: "cond_share", s: condSubject("ai", pu, o2), scope, alts: ruling7c("cond_share", condSubject("ai", puT, o2), today) } };
        }
        // Under ruling 7 the pair can exist only in today's pooled card: the fact counts the same paired units on
        // the ruling's scope.
        if (today)
          for (const T0 of themes) {
            const prT = pairsOf(today).find((x) => (side === "toward" ? x.tt : x.at) === T0);
            if (!prT) continue;
            const puT = side === "toward" ? prT.a : prT.t;
            return { spec: { m: "cond_share", s: condSubject("ai", puT), scope, alts: ruling7c("cond_share", condSubject("ai", puT), today) } };
          }
      }
      // Else the other side's units under near-identical names (the cards' am37 match, before any row is listed).
      const oc = byCore(scope, other);
      if (oc) {
        const ocT = today ? byCore(today, other) ?? oc : oc;
        const o3 = side === "away" && exceptionCell ? { only: "pick:rival" } : {};
        return { spec: { m: "cond_share", s: condSubject("ai", oc, o3), scope, alts: ruling7c("cond_share", condSubject("ai", ocT, o3), today) } };
      }
      return { group: `${g} (also: no other-side row and no both-ways pair found)` };
    }
    return { group: g };
  };

  const group = (dest: string, p: string[]) => {
    const dk = dest.startsWith("rival:") ? "rival page" : dest.includes("/rival:") ? "cell rival part" : "cell";
    const head =
      dk === "rival page" && p[0] === "steps"
        ? p.slice(0, 3).join("/")
        : ["steps", "lines", "detail", "table", "tables", "tableComp"].includes(p[0])
          ? p.slice(0, 2).join("/")
          : p[0];
    return `${dk} ${head}`;
  };

  const mapStat = (stat: any): Mapped => {
    const at = stat.id.indexOf("::");
    const dest: string = stat.id.slice(0, at);
    const p: string[] = stat.id.slice(at + 2).split("/").map(unseg);
    const g = group(dest, p);
    if (stat.k === undefined) return { group: `${g} (sentence number, no counts)` };
    const spec = (m: string, s: string, scope: Scope, alts: Alt[] = []): Mapped => ({ spec: { m, s, scope, alts } });

    /* -- By rival pages -- */
    if (dest.startsWith("rival:")) {
      const R = keyOf(dest.slice("rival:".length));
      const who = (w: string) => (w === "you" ? "you" : R);
      const [, step, part, a, b, c] = p;
      if (p[0] === "byBuyer") {
        const scope: Scope = { types: ["discovery", "use_case"], situation: situationByLabel(["discovery", "use_case"], p[2]) };
        return spec("share_of_picks", p[3] === "0" ? R : "you", scope);
      }
      if (p[0] !== "steps") return { group: g };
      if (part === "conditions") {
        const [side, text] = [p[3] as "toward" | "away", unseg(p[4])];
        const what = p.slice(5);
        const destId = dest;
        const prefix = `steps/${step}/conditions`;
        if (step === "open") return mapCond("chooses:open:all", dest.slice(6), true, side, text, what, destId, prefix, g);
        if (step === "social") return mapCond("chooses:social:all", dest.slice(6), true, side, text, what, destId, prefix, g);
        if (step === "hold") return mapCond("doubts:hold:all", dest.slice(6), false, side, text, what, destId, prefix, g);
        if (step === "h2h" || step === "leavers") {
          const c = h2hCellOf(R, step);
          return c ? mapCond(c, null, false, side, text, what, `cell:${c}`, "conditions", g) : { group: `${g} (no cell)` };
        }
        return { group: g };
      }
      const bar = part === "bar";
      const other = bar && a === "other" ? keyOf(b) : null;
      const s = bar ? (a === "other" ? other! : who(a)) : "";
      switch (step) {
        case "awareness": {
          const scope: Scope = { types: ["problem_recognition"] };
          if (bar) return spec("recommended", s, scope, [ruling6(s, scope)]);
          if (part === "table" && a === "By buyer") {
            const sc: Scope = { types: ["problem_recognition"], situation: situationByLabel(["problem_recognition"], b) };
            const sub = c === "0" ? R : "you";
            return spec("recommended", sub, sc, [ruling6(sub, sc)]);
          }
          return { group: g };
        }
        case "named": {
          if (bar) return spec("named", s, WHAT_TO_BUY_ALL, ruling7("named", s, WHAT_TO_BUY_TODAY));
          if (part === "body") {
            const m = ({ named: ["named", R], recommended: ["recommended", R], youNamed: ["named", "you"], youRecommended: ["recommended", "you"], converts: ["converts", R] } as any)[a];
            if (m) return spec(m[0], m[1], WHAT_TO_BUY_ALL, ruling7(m[0], m[1], WHAT_TO_BUY_TODAY));
          }
          return { group: g };
        }
        case "open":
          if (bar) return spec("share_of_picks", s, WHAT_TO_BUY_ALL, ruling7("share_of_picks", s, WHAT_TO_BUY_TODAY));
          if (part === "table" && a === "What the answer weighs") {
            const code = codeOf(b);
            if (!code) return { group: g };
            const sub = `${c === "0" ? R : "you"}/arg:${code}`;
            return spec("argues_when_picked", sub, WHAT_TO_BUY_ALL, ruling7("argues_when_picked", sub, WHAT_TO_BUY_TODAY));
          }
          return { group: g };
        case "picked":
          if (bar) return spec("picked", s, WHAT_TO_BUY_ALL, ruling7("picked", s, WHAT_TO_BUY_TODAY));
          return { group: g };
        case "social": {
          const scope: Scope = { types: ["social_validation"] };
          if (bar) return spec("recommended", s, scope, [ruling6(s, scope)]);
          return { group: g };
        }
        case "h2h": {
          if (part === "table" && a === "What the answer weighs") {
            const code = codeOf(b);
            const cid = h2hCellOf(R, "h2h");
            const cs2 = cid ? cellScope(cid) : null;
            return code && cs2 ? spec("argues_when_picked", `${c === "0" ? R : "you"}/arg:${code}`, cs2.scope) : { group: g };
          }
          if (!bar) return { group: g };
          // The rival's own matchup: a named head-to-head, or a class head-to-head when the rival is asked about as a class.
          const scope: Scope = { types: ["comparison_entity", "comparison_class"], rival: R };
          if (a === "other") return spec("h2h_neither", "ai", scope);
          return spec("h2h_win", s, scope);
        }
        case "leavers":
          if (bar) return spec("share_of_picks", s, { types: ["switching"], rival: R });
          return { group: g };
        case "buyers":
        case "customers": {
          const types: QT[] = step === "buyers" ? ["objections"] : ["churn_triggers", "renewal"];
          if (bar) return spec("sent_to", s, { types });
          if (part === "table") return spec("sent_to", R, { types, worry: factsOfType(types).find((f) => (f.worry ?? "A worry") === b)?.worry ?? "__no_such_worry__" });
          return { group: g };
        }
        case "value":
          if (bar) return spec("named_instead", s, { types: ["pricing"] });
          if (part === "table") return spec("named_instead", R, { types: ["pricing"], situation: situationByLabel(["pricing"], b) });
          return { group: g };
        case "hold":
          if (bar) return spec("sent_to", s, { types: ["looking_around"] });
          return { group: g };
      }
      return { group: g };
    }

    /* -- cells and the rival parts inside them -- */
    const rivalPart = dest.includes("/rival:") ? dest.slice(dest.indexOf("/rival:") + "/rival:".length) : null;
    const cellId = dest.slice("cell:".length, rivalPart !== null ? dest.indexOf("/rival:") : undefined);
    const kind = kindOf(cellId);
    const cs = cellScope(cellId);
    if (!kind || !cs) return { group: g };
    const { scope, today } = cs;
    const R = rivalPart !== null ? keyOf(rivalPart) : null;
    const brandOf = (w: string) => (w === "you" ? "you" : w === "rival" && R ? R : keyOf(w));
    const funnelKinds = new Set(["buy", "switching", "problem", "popular", "premium", "learning"]);
    /** The rival's own card inside the cell (panel 11), when the stat is on one. */
    const rivalObj = R ? (map.positions[cellId] as any)?.panel?.rivals?.find((x: any) => keyOf(x.name) === R) : null;

    if (p[0] === "conditions") {
      const prefix = "conditions";
      return mapCond(cellId, rivalPart, rivalPart !== null, p[1] as "toward" | "away", p[2], p.slice(3), dest, prefix, g);
    }
    // Lost, with an exception: of the answers that pick the rival, the ones still stating a condition for you.
    if (!R && p[0] === "detail" && p[1] === "exception" && p[2] === "section") {
      const units = unitsBy(scope, "toward", flavorOf(cellId)).get(condKey(p[4]));
      return units ? spec("cond_share", condSubject("ai", units), { ...scope, when: "pick:rival" }) : { group: `${g} (no unit found for the row)` };
    }
    // The Habit card: stick with you, pick another brand, say it depends, name no pick; and "suggests another brand".
    if (!R && kind === "habit" && p[0] === "steps" && p[1] === "habit" && p[2] === "seg") {
      const r8 = { label: "ruling 8 (a pick outside of analysis or the category is its own bucket; today's Habit card counts it as 'picks another brand')", kind: "ruling" as const, calc: () => book.fact("slice_share", "ai/slice:pick:other|pick:outside_analysis|pick:outside_category", scope) };
      const ex = ({ stick: "pick:you", other: "pick:other", depends: "pick:none&v:outcome:conditional", nopick: "pick:none&!v:outcome:conditional" } as any)[p[3]];
      return ex ? spec("slice_share", `ai/slice:${ex}`, scope, p[3] === "other" ? [r8] : []) : { group: g };
    }
    if (!R && kind === "habit" && p[0] === "steps" && p[1] === "offers") return spec("slice_share", "ai/slice:rec:anyother", scope);
    if (!R && p[0] === "steps" && p[1] === "exception" && p[2] === "seg") {
      const all = new Set([...unitsBy(scope, "toward", flavorOf(cellId)).values()].flatMap((x) => [...x]));
      const sub = condSubject("ai", all);
      if (p[3] === "still") return spec("cond_share", sub, { ...scope, when: "pick:rival" });
      if (p[3] === "none") return spec("cond_none", sub, { ...scope, when: "pick:rival" });
    }

    if (p[0] === "steps") {
      const [, step, who, a] = p;
      // A rival's own card inside a cell.
      if (R) {
        if (step === "named") return spec("named", who === "you" ? "you" : R, scope, ruling7("named", who === "you" ? "you" : R, today));
        if (step === "converts") return spec("converts", who === "you" ? "you" : R, scope, ruling7("converts", who === "you" ? "you" : R, today));
        if (step === "recommended") {
          const s = who === "you" ? "you" : R;
          if (kind === "buy" || kind === "switching") return spec("recommended", s, scope, ruling7("recommended", s, today));
          if (kind === "problem" || kind === "popular" || kind === "premium") return spec("recommended", s, scope, [ruling6(s, scope)]);
          if (kind === "buyer_worry" || kind === "customer_worry" || kind === "looking_around") return who === "you" ? { group: g } : spec("sent_to", R, scope);
          if (kind === "value") return who === "you" ? spec("worth_yes", "ai", scope) : spec("named_instead", R, scope);
          // Habit: "suggested instead" = the rival recommended or picked (ruling 6).
          if (kind === "habit" && who !== "you") return spec("slice_share", `ai/slice:rec:${R}`, scope);
        }
        return { group: g };
      }
      if (who === "usual") {
        if (/Average competitor/.test(stat.words)) return { group: `${g} (average competitor: a selection, layer 3)` };
        const usual = kind === "learning" ? cellScope("chooses:awareness:all") : step === "commits" ? cellScope("chooses:open:all") : rowAllScope(cellId);
        if (!usual) return { group: g };
        const m = ({ named: "named", recommended: "recommended", converts: "converts", category: "routed_category", anybrand: "names_any_brand", namedwhen: "named_when_any", commits: "commit_rate", agrees: "agrees", decided: "h2h_decided" } as any)[step];
        if (!m) return { group: g };
        const s = ["routed_category", "names_any_brand", "commit_rate", "agrees", "h2h_decided"].includes(m) ? "ai" : "you";
        return spec(m, s, usual.scope, ruling7(m, s, usual.today));
      }
      if (who === "seg" || who === "usualseg") {
        const m = segMeasure(kind, step, a);
        if (!m) return { group: g };
        const sc = who === "usualseg" ? rowAllScope(cellId) : cs;
        if (!sc) return { group: g };
        const alts: Alt[] = [];
        if (m === "tier_balanced")
          alts.push({
            label: "ruling 13 (a premium answer with no stance is its own share, never 'balanced'; today's card counts it as balanced)",
            kind: "ruling",
            calc: () => {
              const a1 = book.fact("tier_balanced", "ai", sc.scope);
              const a2 = book.fact("tier_none", "ai", sc.scope);
              return { k: a1.k + a2.k, n: a1.n };
            },
          });
        return spec(m, "ai", sc.scope, alts);
      }
      if (step === "taught" && who === "item") {
        const code = codeOf(a);
        return code ? spec("argues", `ai/arg:${code}`, scope) : { group: g };
      }
      if (who === "you" || who === "vs" || who === "rival") {
        const s = who === "you" ? "you" : who === "vs" ? "rival" : brandOf(a);
        if (step === "won") return spec("h2h_two_way", s, scope);
        if (step === "decided") return spec("h2h_decided", "ai", scope);
        if (funnelKinds.has(kind) && (step === "named" || step === "recommended" || step === "converts")) {
          const alts = step === "recommended" && who !== "you" && (kind === "problem" || kind === "popular" || kind === "premium") ? [ruling6(s, scope)] : [];
          return spec(step, s, scope, [...ruling7(step, s, today), ...alts]);
        }
        if (who !== "you") return { group: g };
        const m = ({ category: "routed_category", anybrand: "names_any_brand", namedwhen: "named_when_any", commits: "commit_rate", agrees: "agrees", offers: "sent_to_any" } as any)[step];
        // The Habit card's "offers" counts brands it suggests from rules and mentions too - not a measure yet.
        if (!m || (step === "offers" && kind !== "looking_around")) return { group: g };
        return spec(m, m === "named_when_any" ? "you" : "ai", scope, ruling7(m, m === "named_when_any" ? "you" : "ai", today));
      }
      return { group: g };
    }

    if (p[0] === "lines") {
      const [, line, span] = p;
      if (line === "commit" && span === "rate") return spec("commit_rate", "ai", scope, ruling7("commit_rate", "ai", today));
      if ((line === "share" || line === "picked") && (span === "you" || span === "usual")) {
        const m = line === "share" ? "share_of_picks" : "picked";
        const sc = span === "usual" ? rowAllScope(cellId) : cs;
        if (!sc) return { group: g };
        return spec(m, "you", sc.scope, ruling7(m, "you", sc.today));
      }
      if (span === "avg") return { group: `${g} (average competitor: a selection, layer 3)` };
      return { group: g };
    }

    if (p[0] === "competitors" && !R) {
      const s = brandOf(p[1]);
      if (kind === "buy" || kind === "switching") return spec("share_of_picks", s, scope, ruling7("share_of_picks", s, today));
      if (kind === "problem" || kind === "popular" || kind === "premium") return spec("recommended", s, scope, [ruling6(s, scope)]);
      if (kind === "learning") return spec("named", s, scope);
      if (kind === "buyer_worry" || kind === "customer_worry" || kind === "looking_around") return spec("sent_to", s, scope);
      return { group: g };
    }

    const mapOutcome = (b: string, s: string, sc: Scope, td: Scope | undefined): Mapped => {
      const m = b === "lost" ? "recommended_lost" : b === "none" ? "recommended_no_pick" : null;
      if (!m) return { group: g };
      const alts = ruling7(m, s, td);
      const key = s === "you" ? T : s;
      const rec = (f: any) => f.brands.some((nb: any) => nb.key === key && nb.recommended);
      if (m === "recommended_no_pick") {
        // Ruling 12: a pick outside the category is never "no single pick" - its own share; today's card folds it in.
        const fold = (x: Scope) => countWith(x, rec, (f) => f.pick.state === "none" || f.pick.state === "outside_category");
        alts.push({ label: "ruling 12 (a pick outside the category is its own share, never 'no single pick'; today's card folds it in)", kind: "ruling", calc: () => fold(sc) });
        if (td) alts.push({ label: "ruling 7 + ruling 12 (today's four-type pool, and 'no single pick' folding in picks outside the category)", kind: "ruling", moves: { ruling: "R7", check: "listed" }, calc: () => fold(td) });
      } else {
        // Ruling 8: a pick outside of analysis is its own bucket; today's card counts it as lost to another brand.
        const fold = (x: Scope) => countWith(x, rec, (f) => (f.pick.state === "in_analysis" || f.pick.state === "outside_analysis") && f.pick.key !== key);
        alts.push({ label: "ruling 8 (a pick outside of analysis is its own bucket; today's card counts it as lost to another brand)", kind: "ruling", calc: () => fold(sc) });
      }
      return spec(m, s, sc, alts);
    };
    /** The step explanation object a detail path reads (the cell's, or a rival part's; the comparison view's). */
    const detailObj = (view: string, step: string) => {
      const pp = R ? rivalObj : (map.positions[cellId] as any)?.panel;
      return (view === "detailComp" ? pp?.detailsComp : pp?.details)?.[step];
    };

    if (p[0] === "detail" || p[0] === "detailComp") {
      const [view, step, what, a, b] = p;
      if (what === "row" && step === "named") {
        const d = detailObj(view, step);
        let s: string | null = b === "you" ? "you" : R;
        let sc2: { scope: Scope; today?: Scope } = { scope, today };
        if (b === "rival" && !R) {
          const col = d?.columns?.rival;
          if (!col || col === "Average competitor") return { group: `${g} (average competitor: a selection, layer 3)` };
          if (d.columns.rivalIsUsual) {
            const u = rowAllScope(cellId);
            if (!u) return { group: g };
            s = "you";
            sc2 = u;
          } else s = keyOf(col);
        }
        if (a === "Named but not recommended") return spec("named_not_recommended", s!, sc2.scope, ruling7("named_not_recommended", s!, sc2.today));
        if (/^Of those, named as .* to avoid$/.test(a)) return spec("negative_when_named_not_recommended", s!, sc2.scope, ruling7("negative_when_named_not_recommended", s!, sc2.today));
        return { group: g };
      }
      if (what === "outcome" && step === "converts") {
        if (a === "Average competitor") return { group: `${g} (average competitor: a selection, layer 3)` };
        // "Here" is you in this cell; "All buyers" / "All rivals' customers" is you on the row's All cell (the usual).
        const usualRow = a === "All buyers" || a === "All rivals' customers";
        const s = a === "You" || a === "Here" || a === brand || usualRow ? "you" : keyOf(a);
        if (usualRow) {
          const u = rowAllScope(cellId);
          return u ? mapOutcome(b, s, u.scope, u.today) : { group: g };
        }
        return mapOutcome(b, s, scope, today);
      }
      // Who takes the pick when the AI recommends you and picks another brand.
      if (what === "list" && step === "recommended" && !R) {
        const k = keyOf(a);
        const sub = `ai/slice:pick:${k}`;
        const base = "rec:you&pick:other";
        return spec("slice_share", sub, { ...scope, when: base }, [
          ...ruling7("slice_share", sub, today ? { ...today, when: base } : undefined),
          { label: "ruling 8 (a pick outside of analysis is its own bucket; today's card counts it among 'picks another brand')", kind: "ruling", calc: () => book.fact("slice_share", sub, { ...scope, when: "rec:you&pick:other|rec:you&pick:outside_analysis" }) },
        ]);
      }
      // A head-to-head that picks neither of the two.
      if (what === "list" && step === "decided" && !R) {
        if (/^Picks another /.test(a))
          return spec("slice_share", "ai/slice:pick:other&!pick:rival", scope, [
            { label: "ruling 8 (a pick outside of analysis is its own bucket; today's card counts it as another brand)", kind: "ruling", calc: () => book.fact("slice_share", "ai/slice:pick:other&!pick:rival|pick:outside_analysis", scope) },
          ]);
        if (a === "No single pick")
          return spec("slice_share", "ai/slice:pick:none", scope, [
            { label: "ruling 12 (a pick outside the category is its own share, never 'no single pick'; today's card folds it in)", kind: "ruling", calc: () => book.fact("slice_share", "ai/slice:pick:none|pick:outside_category", scope) },
          ]);
      }
      if (what === "section") {
        const title = a;
        const label = b;
        const vs = VENDOR_SECTION.find(([re]) => re.test(title));
        if (vs) return spec(vs[1], vs[2], { ...scope, vendor: label }, ruling7(vs[1], vs[2], today ? { ...today, vendor: label } : undefined));
        if (step === "category" && title === "Where the other answers point" && /^Points to something other than /.test(label)) {
          // Ruling 5: "adjacent" only; "none" is its own share (today's count, where it differs: not "category").
          return spec("routed_adjacent", "ai", scope, [{ label: "ruling 5 (problem questions outside the category = adjacent only; today's count folds in 'none')", kind: "ruling", calc: () => { const a1 = book.fact("routed_adjacent", "ai", scope); const a2 = book.fact("routed_none", "ai", scope); return { k: a1.k + a2.k, n: a1.n }; } }]);
        }
        if (step === "commits" && title === "What the answer does instead") {
          if (/^Says it depends/.test(label)) return spec("outcome_conditional", "ai", scope);
          // "Lists several without choosing" is every answer that neither commits nor says it depends (clarifying
          // questions and picks outside the category folded in) - no measure states that; left uncovered.
        }
        if (step === "agrees" && title === "The other judgements") return spec(/^Partly/.test(label) ? "partly_agrees" : "disagrees", "ai", scope);
        if (step === "agrees" && title === "Which worries it agrees with most") return spec("agrees", "ai", { ...scope, worry: factsOfType(scope.types as QT[]).find((f) => (f.worry ?? "A worry") === label)?.worry ?? "__no_such_worry__" });
        if (step === "relationship" && title === "By question") return SETTLED_LABEL[norm(label)] ? spec("relationship_strengthens", "ai", { types: [SETTLED_LABEL[norm(label)]] }) : { group: g };
        if (step === "instead" && title === "Where it points the buyer instead") return spec("named_instead", keyOf(label), scope);
        if (step === "taught" && title === "Which brands it names while teaching") return spec("named", label === "You" ? "you" : keyOf(label), scope);
        const sl = (expr: string, sc: Scope = scope, alts: Alt[] = []): Mapped => spec("slice_share", `ai/slice:${expr}`, sc, alts);
        const at = (when: string): Scope => ({ ...scope, when });
        // Worries: what the AI advises after agreeing, or after saying the worry is wrong.
        if (step === "agrees" && /^What it advises when it (agrees|says the worry is wrong)$/.test(title)) {
          const w = /agrees$/.test(title) ? "v:premise_verdict:confirms" : "v:premise_verdict:rebuts";
          const m = ({ "Go ahead": "go_ahead", "Steer clear": "steer_clear", Stay: "stay", Leave: "leave" } as any)[label] ?? (label === "No side" ? (kind === "buyer_worry" ? "buyer_no_side" : "customer_no_side") : null);
          return m ? spec(m, "ai", at(w)) : { group: g };
        }
        // Value: of the answers giving each verdict, the share naming a rival.
        if (step === "instead" && title === "By what the AI said, the share that name a rival") {
          const v = /not worth/i.test(label) ? "no" : /depends/i.test(label) ? "depends" : "yes";
          return spec("instead_rival", "ai", at(`v:worth_it:${v}`));
        }
        // Answering a critic: how strong the answer is when it says the critic is right / partly right.
        if (step === "premise" && /^How it answers when it says the critic is (right|partly right)$/.test(title)) {
          const w = /partly/.test(title) ? "v:premise_verdict:mixed" : "v:premise_verdict:confirms";
          return label === "A strong answer" ? spec("case_strong", "ai", at(w)) : sl("!v:case_strength:strong", at(w));
        }
        if (step === "premise" && title === "Which AI companies side with the critic most") return spec("agrees", "ai", { ...scope, vendor: label });
        // The rivals that come up while the AI makes or defends the case.
        if (step === "strength" && /^Which rivals come up/.test(title)) return spec("named", keyOf(label), scope);
        // The settled questions where the answer weakens the relationship.
        if (step === "relationship" && title === "Where it weakens the relationship") return SETTLED_LABEL[norm(label)] ? spec("relationship_weakens", "ai", { types: [SETTLED_LABEL[norm(label)]] }) : { group: g };
        if (step === "tier" && title === "Which AI companies side with basic most") return spec("tier_basic", "ai", { ...scope, vendor: label });
        // The answer names one pick: which AI companies, and who gets the pick.
        if (step === "commits" && title === "Which AI companies name one pick") return spec("commit_rate", "ai", { ...scope, vendor: label });
        if (step === "commits" && title === "Who gets the pick when it names one") return spec("share_of_picks", label === "You" || label === brand ? "you" : keyOf(label), scope);
        if (step === "commits" && title === "What the answer does instead" && /^Lists several/.test(label))
          // "Lists several without choosing" = answers that pick nothing (no pick, a pick that names nothing, or a
          // clarifying question) and do not say it depends. Ruling 12: a pick outside the category is its own share.
          return sl("pick:none&!v:outcome:conditional", scope, [{ label: "ruling 12 (a pick outside the category is its own share; today's card counts it among 'lists several without choosing')", kind: "ruling", calc: () => book.fact("slice_share", "ai/slice:pick:none&!v:outcome:conditional|pick:outside_category", scope) }]);
        // Habit: which AI companies say try something else; who gets the pick; who it suggests first.
        const r8 = "pick:other|pick:outside_analysis|pick:outside_category";
        if (step === "habit" && title === "Which AI companies say try something else most")
          return sl("pick:other", { ...scope, vendor: label }, [{ label: "ruling 8 (a pick outside of analysis or the category is its own bucket; today's Habit card counts it as 'try something else')", kind: "ruling", calc: () => book.fact("slice_share", `ai/slice:${r8}`, { ...scope, vendor: label }) }]);
        if (step === "habit" && title === "When it names a pick, who gets it") return spec("share_of_picks", label === "You" ? "you" : keyOf(label), scope);
        if (step === "offers" && title === "Who it suggests first") return sl(`firstrec:${keyOf(label)}`, at("rec:anyother"));
        // Looking around: which brands it shows, who first, how long the list is.
        if (step === "offers" && /^Which .* it (shows|suggests instead)$/.test(title)) return kind === "habit" ? sl(`rec:${keyOf(label)}`) : spec("sent_to", keyOf(label), scope);
        if (step === "offers" && title === "Who it shows first") return sl(`firstsent:${keyOf(label)}`, at("sent:any"));
        if (step === "offers" && title === "How long its list is") {
          const r = /^One or two/.test(label) ? "1-2" : /^Three to five/.test(label) ? "3-5" : /^Six or more/.test(label) ? "6-999" : null;
          return r ? sl(`nsent:${r}`) : { group: g };
        }
        // What to look for: how long its list is, which buyers are taught a topic, which AI companies teach it.
        if (step === "taught" && title === "How long its list is") {
          const r = /^Six or fewer/.test(label) ? "1-6" : /^Seven to twelve/.test(label) ? "7-12" : /more/.test(label) ? "13-999" : null;
          return r ? sl(`nargs:${r}`) : { group: g };
        }
        if (step === "taught" && /^Which buyers are taught /.test(title)) {
          const code = codeOf(title.replace(/^Which buyers are taught /, ""));
          const sit = factsOfType(scope.types as QT[]).find((f) => f.situation === label)?.situation;
          return code && sit ? spec("argues", `ai/arg:${code}`, { ...scope, situation: sit }) : { group: g };
        }
        if (step === "taught" && /^Which AI companies teach /.test(title)) {
          const code = codeOf(title.replace(/^Which AI companies teach /, ""));
          return code ? spec("argues", `ai/arg:${code}`, { ...scope, vendor: label }) : { group: g };
        }
        // What to use alongside you: how many it names.
        if (step === "alongside" && title === "How many it names") {
          const r = label === "One" ? "1-1" : /^Two or three/.test(label) ? "2-3" : /more/i.test(label) ? "4-999" : null;
          return r ? sl(`npair:${r}`) : { group: g };
        }
        if (step === "alongside" && /^Which AI companies name/.test(title)) return sl("pair:own", { ...scope, vendor: label });
        // Learning the category: who is named first, and who is named when you are not.
        // Spotting the problem: what it recommends where it points outside the category (names framed recommended).
        if (step === "category" && title === "What it recommends there") {
          // The row is named by the entry the names resolve to (never an active brand): find it by that name first
          // (resolving the name again can land on an active brand's alias - a maker word).
          // (A name the context judge placed with a maker that is no entry carries a "?" key and the maker's name.)
          const b = book.rows(scope).flatMap((f: any) => f.brands).find((x: any) => x.bucket === "outside_category" && x.framedRecommended && x.name === label);
          return b ? sl(`frec:${b.key}`, at("v:category_routed:adjacent")) : { group: `${g} (no name found)` };
        }
        // Expansion: where it points them instead, of the answers that point elsewhere.
        if (step === "stance" && title === "Where it points them instead") return sl(`sentname:${label}`, at("v:growth_stance:redirects"));
        if (step === "namedwhen" && title === "Who is named first") return sl(`first:${label === "You" ? "you" : keyOf(label)}`, at("anybrand"));
        if (step === "namedwhen" && /^Who is named when/.test(title)) return spec("named", keyOf(label), at("anybrand&!named:you"));
        return { group: `${g}/${title.replace(/^(Which|What|Where|How|Who) .*/, "$1 ...")}` };
      }
      return { group: g };
    }

    if (((p[0] === "table" || p[0] === "tableComp") && p[1] === "What these answers cover") || (p[0] === "tables" && p[1] === "What the answer weighs")) {
      const code = codeOf(p[2]);
      if (!code) return { group: g };
      if (p[3] === "0") return spec("argues", `ai/arg:${code}`, scope);
      // The second column: the row's All cell (Spotting the problem), Spotting the problem for Learning the category,
      // What to buy for What's popular.
      const u = kind === "learning" ? cellScope("chooses:awareness:all") : kind === "popular" ? cellScope("chooses:open:all") : rowAllScope(cellId);
      return u ? spec("argues", `ai/arg:${code}`, u.scope, ruling7("argues", `ai/arg:${code}`, u.today)) : { group: g };
    }
    // The settled cards' argued topics: a share of the strong (or confident) answers.
    if (p[0] === "table" && (p[1] === "What a strong answer argues" || p[1] === "What a confident case argues") && p[3] === "0") {
      const code = codeOf(p[2]);
      return code ? spec("argues", `ai/arg:${code}`, { ...scope, when: "v:case_strength:strong" }) : { group: g };
    }
    // Panel 11: where the rival takes its picks across the row's buyer cards.
    if (R && p[0] === "byCell") {
      const c = cellScope(p[1]);
      return c ? spec("share_of_picks", p[2] === "you" ? "you" : R, c.scope, ruling7("share_of_picks", p[2] === "you" ? "you" : R, c.today)) : { group: g };
    }
    // What to look for: the topic among the answers that pick another brand / you (the buyer's own What to buy
    // answers when there are enough, else every buyer's), and the share of these answers taught it.
    if (p[0] === "table" && p[1] === "What the answer weighs, against the checklist") {
      const code = codeOf(p[2]);
      if (!code) return { group: g };
      if (p[3] === "2") return spec("argues", `ai/arg:${code}`, scope);
      const t = (map.positions[cellId] as any).panel.table;
      const local = /of this buyer/.test(t?.sub ?? "") && scope.situation;
      const src = local ? { scope: { types: ["discovery", "use_case"] as QT[], situation: scope.situation }, today: undefined } : { scope: WHAT_TO_BUY_ALL, today: WHAT_TO_BUY_TODAY };
      const m = p[3] === "0" ? "argues_when_other_picked" : "argues_when_picked";
      return spec(m, `you/arg:${code}`, src.scope, ruling7(m, `you/arg:${code}`, src.today));
    }

    // Premium vs basic: who it names at each end - a brand row is the share of answers with a rule choosing that end
    // that names one of the brand's products. (Rows of names that are no brand are product names: not covered.)
    if (p[0] === "ends" && p[3] === "num") {
      const end = p[1] === "0" ? "premium" : "basic";
      const lab = unseg(p[2]);
      const r = lab === "You" ? { status: "active", key: T } : set.resolve(lab);
      if (r.status !== "active") return { group: `${g} (product names as written: no product grouping in layer 1 yet)` };
      return spec("slice_share", `ai/slice:ruleprod:${end}:${r.key}`, scope);
    }
    if (p[0] === "byProduct") {
      const m = ["worth_yes", "worth_depends", "worth_no"][Number(p[3])];
      return m ? spec(m, "ai", { ...scope, line: p[2] }) : { group: g };
    }

    // "What the answer weighs" on every other card: a topic's share among the answers of one side (a slice), and
    // the same topic's share on the other side's own answers ("other").
    if (p[0] === "weighs" && (rivalObj ? !rivalObj.full : !(kind === "buy" || kind === "switching"))) {
      const [, view, col, label, what] = p;
      const code = codeOf(label);
      if (!code) return { group: g };
      const w = rivalObj ? rivalObj.weighs : view === "comp" ? (map.positions[cellId] as any).panel.weighsComp : (map.positions[cellId] as any).panel.weighs;
      const two = (w?.columns?.length ?? 0) === 2;
      let sides: (string | undefined)[] = [undefined];
      let rule6: string | null = null;
      let rule8: string | null = null;
      if (rivalObj) {
        const alt =
          kind === "buyer_worry" || kind === "customer_worry" || kind === "looking_around" ? `sent:${R}` : kind === "value" ? `instead:${R}` : kind === "habit" ? `rec:${R}` : `rec:${R}`;
        // Spotting the problem / What's popular / Premium vs basic: the card counts the framing only (ruling 6 counts the pick).
        if (!(kind === "buyer_worry" || kind === "customer_worry" || kind === "looking_around" || kind === "value" || kind === "habit")) rule6 = `frec:${R}`;
        sides = two ? [alt, `!${alt}`] : [alt];
      } else if (two) {
        if (kind === "buyer_worry") sides = ["v:proceed_or_avoid:proceed", "v:proceed_or_avoid:avoid|v:premise_verdict:confirms&!v:proceed_or_avoid:proceed"];
        else if (kind === "customer_worry") sides = ["v:keep_or_leave:keep", "v:keep_or_leave:leave"];
        else if (kind === "value") sides = ["v:worth_it:yes", "v:worth_it:no"];
        else if (kind === "premium") sides = ["v:tier_stance:premium", "v:tier_stance:basic"];
        else if (kind === "habit") {
          sides = ["pick:you", "pick:other"];
          rule8 = "pick:other|pick:outside_analysis|pick:outside_category";
        } else return { group: `${g} (two-sided weighs on an unexpected card)` };
      }
      const ci = what === "num" ? Number(col) : 1 - Number(col);
      const when = sides[ci];
      const sub = `ai/arg:${code}`;
      const sc = (x: Scope, wh: string | undefined): Scope => (wh ? { ...x, when: wh } : x);
      const alts: Alt[] = [...ruling7("argues", sub, today ? sc(today, when) : undefined)];
      if (rule6 && when) {
        const old = when.replace(`rec:${R}`, rule6);
        alts.push({ label: "ruling 6 (a pick counts as recommended; today's count leaves the pick out)", kind: "ruling", calc: () => book.fact("argues", sub, sc(scope, old)) });
      }
      if (rule8 && when === "pick:other")
        alts.push({ label: "ruling 8 (a pick outside of analysis or outside the category is its own bucket; today's Habit card counts it as 'picks another brand')", kind: "ruling", calc: () => book.fact("argues", sub, sc(scope, rule8!)) });
      return spec("argues", sub, sc(scope, when), alts);
    }
    // A rival's full card: the answers that pick you (column 0) against the answers that pick the rival.
    if (p[0] === "weighs" && rivalObj?.full) {
      const [, , col, label, what] = p;
      const code = codeOf(label);
      if (!code) return { group: g };
      const ci = what === "num" ? Number(col) : 1 - Number(col);
      const sub = `${ci === 0 ? "you" : R}/arg:${code}`;
      return spec("argues_when_picked", sub, scope, ruling7("argues_when_picked", sub, today));
    }
    if (p[0] === "weighs" && (kind === "buy" || kind === "switching")) {
      const [, view, col, label, what] = p;
      const code = codeOf(label);
      if (!code) return { group: g };
      // The plain view of these cards is one unsided column over every answer.
      if (view === "plain") return what === "num" && !R ? spec("argues", `ai/arg:${code}`, scope, ruling7("argues", `ai/arg:${code}`, today)) : { group: g };
      // The comparison view: column 0 = the answers that pick you, column 1 = the answers that pick another brand
      // in analysis (ruling 2); "other" is the same topic's share on the other column's base. Inside a rival's
      // own card, column 1 is the answers that pick that rival.
      const side = (what === "num" ? col : String(1 - Number(col))) === "0";
      if (R) {
        const sub = `${side ? "you" : R}/arg:${code}`;
        return spec("argues_when_picked", sub, scope, ruling7("argues_when_picked", sub, today));
      }
      const m = side ? "argues_when_picked" : "argues_when_other_picked";
      return spec(m, `you/arg:${code}`, scope, ruling7(m, `you/arg:${code}`, today));
    }

    return { group: g };
  };

  /* ---------- compare ---------- */
  const local = { compared: 0, equal: 0, explained: new Map<string, number>(), unexplained: [] as string[], notCovered: new Map<string, number>() };
  const textOk = (statValue: string, factText: string) => statValue === factText || (factText === "<1%" && statValue === "1%");
  /** Product names: the cards decide what counts as one of a brand's products by a run-wide test (panel_build
   * productIndex, am43) and group written names three ways (productSplit, mergeProducts, the Value card's own-option
   * merge); layer 1 carries no product-name field yet - a product grouping is a ruling to make first. */
  const PRODUCT_PATH = /::(products\/|tables\/Which of your |steps\/alongside\/item\/|detail\/[a-z]+\/section\/(Which of your |Which [^/]+ it names\/|Your own cheaper options named|The specific |Which one it names first))/;
  /** Every printed text a covered fact stands behind, per card (dest): the sentence-number check reads it. */
  const coveredText = new Map<string, Set<string>>();
  const sentenceStats: any[] = [];
  for (const stat of reg.all()) {
    let mapped = mapStat(stat);
    if ("group" in mapped && stat.k !== undefined && PRODUCT_PATH.test(stat.id) && !/\(/.test(mapped.group)) mapped = { group: `${mapped.group} (product names: no product grouping in layer 1 yet)` };
    if ("group" in mapped && stat.k === undefined) sentenceStats.push(stat);
    if ("group" in mapped) {
      local.notCovered.set(mapped.group, (local.notCovered.get(mapped.group) ?? 0) + 1);
      if (DUMP) dumpRows.push(JSON.stringify({ b: brand, g: mapped.group, id: stat.id, v: stat.value, k: stat.k, n: stat.n, w: stat.words }));
      continue;
    }
    const { m, s, scope, alts } = mapped.spec;
    local.compared++;
    {
      const dest = stat.id.slice(0, stat.id.indexOf("::"));
      const set2 = coveredText.get(dest) ?? new Set<string>();
      set2.add(stat.value);
      coveredText.set(dest, set2);
    }
    byMeasure.set(m, (byMeasure.get(m) ?? 0) + 1);
    let f: any;
    try {
      f = book.fact(m, s, scope);
    } catch (e: any) {
      local.unexplained.push(`${stat.id}: ${e.message}`);
      continue;
    }
    // RULING_MOVES: what each ruling was measured to move on this stat (card and By rival screens).
    const moved = (ruling: string) => movesOf(ruling, brand, stat.id);
    if (f.k === stat.k && f.n === stat.n && textOk(stat.value, f.text)) {
      // Equal to today's card: no measured ruling may move it.
      const r7 = moved("R7");
      if (r7 && r7.kind === "changed" && (r7.before.k !== r7.after?.k || r7.before.n !== r7.after?.n)) {
        local.unexplained.push(`${stat.id}: equal to today's card, but RULING_MOVES has ruling 7 moving it (${r7.raw.before} -> ${r7.raw.after})`);
        continue;
      }
      local.equal++;
      continue;
    }
    let explained: string | null = null;
    for (const alt of alts ?? []) {
      const x = alt.calc();
      if (x.k !== stat.k || x.n !== stat.n) continue;
      if (alt.moves && movesLoaded) {
        const mv = moved(alt.moves.ruling);
        if (!mv) {
          local.unexplained.push(`${stat.id}: explained by ${alt.moves.ruling} here, but RULING_MOVES does not list it as moved`);
          explained = "__failed__";
          break;
        }
        if (alt.moves.check === "exact" && mv.kind === "changed" && (mv.after?.k !== f.k || mv.after?.n !== f.n)) {
          local.unexplained.push(`${stat.id}: ${alt.moves.ruling} moves it to ${mv.raw.after} in RULING_MOVES, the fact gives ${f.k}/${f.n}`);
          explained = "__failed__";
          break;
        }
        movesConfirmed++;
      }
      explained = alt.label;
      break;
    }
    if (explained === "__failed__") continue;
    if (explained) local.explained.set(explained, (local.explained.get(explained) ?? 0) + 1);
    else local.unexplained.push(`${stat.id} = ${stat.value} (${stat.k}/${stat.n}); fact ${f.id} = ${f.text} (${f.k}/${f.n})${(alts ?? []).length ? `; tried ${(alts ?? []).map((a) => { const x = a.calc(); return `${a.label.split(" (")[0]} ${x.k}/${x.n}`; }).join(", ")}` : ""}`);
  }

  /* ---------- the Data page cross-check (a sample) ---------- */
  const wb: any = computeWorkbench(data);
  const POOL_SCOPE: Record<string, Scope> = {
    headline: WHAT_TO_BUY_TODAY,
    premium_tier: { types: ["premium_worth"] },
    head_to_head_entity: { types: ["comparison_entity"] },
    head_to_head_class: { types: ["comparison_class"] },
    offensive_capture: { types: ["switching"] },
    defensive_hold: { types: ["looking_around"] },
    value: { types: ["pricing"] },
    awareness_routing: { types: ["problem_recognition"] },
    awareness_explainer: { types: ["category_education"] },
    doubt: { types: ["objections"] },
    keep_or_leave: { types: ["churn_triggers", "renewal"] },
    settled_business_case: { types: ["business_case"] },
    settled_expansion: { types: ["expansion"] },
    settled_ecosystem: { types: ["ecosystem"] },
    settled_advocacy: { types: ["advocacy"] },
  };
  const PAIRS: [string, string, "brand" | "ai" | "you" | "rival"][] = [
    ["mentioned", "named", "brand"],
    ["recommended", "recommended", "brand"],
    ["chosen", "picked", "brand"],
    ["share_of_decided", "share_of_picks", "brand"],
    ["out_of_category", "picks_outside_category", "ai"],
    ["h2h_you", "h2h_win", "you"],
    ["h2h_rival", "h2h_win", "rival"],
    ["h2h_other", "h2h_another", "ai"],
    ["h2h_two_way", "h2h_two_way", "you"],
    ["worth_yes", "worth_yes", "ai"],
    ["worth_depends", "worth_depends", "ai"],
    ["worth_no", "worth_no", "ai"],
    ["proceed", "go_ahead", "ai"],
    ["avoid", "steer_clear", "ai"],
    ["proceed_undecided", "buyer_no_side", "ai"],
    ["keep", "stay", "ai"],
    ["leave", "leave", "ai"],
    ["keep_undecided", "customer_no_side", "ai"],
    ["premise_confirms", "agrees", "ai"],
    ["premise_rebuts", "disagrees", "ai"],
    ["premise_mixed", "partly_agrees", "ai"],
    ["routed_category", "routed_category", "ai"],
    ["routed_adjacent", "routed_adjacent", "ai"],
    ["routed_none", "routed_none", "ai"],
    ["rel_strengthens", "relationship_strengthens", "ai"],
    ["rel_weakens", "relationship_weakens", "ai"],
    ["growth_backs", "growth_backs", "ai"],
    ["case_strong", "case_strong", "ai"],
  ];
  // Known fault (ENGINE_INVENTORY_2026-11-17.md section 5 #1): two spellings sharing one match key resolve by
  // whichever the resolver meets first. The answer facts meet mentions in order of appearance; the Data page meets
  // them as stored. Reproduced: a resolver warmed in stored order, counting "named" the Data page's way.
  const rawOrderNamed = (key: string, scope: Scope) => {
    const resolve = buildResolver(data.dictionary, data.judged);
    for (const c of data.codes) for (const m of c.mentions ?? []) if (m?.brand) resolve(m.brand);
    const ids = new Set(book.rows(scope).map((f: any) => f.responseId));
    let k = 0;
    for (const c of data.codes) {
      if (!ids.has(c.response_id)) continue;
      const hit = (c.mentions ?? []).some((m: any) => m?.brand && resolve(m.brand).status === "active" && resolve(m.brand).key === key) || (c.outcome === "pick" && c.top_pick && resolve(c.top_pick).status === "active" && resolve(c.top_pick).key === key);
      if (hit) k++;
    }
    return k;
  };
  const brandIdx = new Map(wb.brands.map((b: any, i: number) => [set.resolve(b.name).key, i]));
  const sampleBrands = [T, ...wb.brands.slice(0, 6).map((b: any) => set.resolve(b.name).key).filter((k: string) => k !== T)].slice(0, 6);
  for (const [pool, scope] of Object.entries(POOL_SCOPE)) {
    const promptsIn = new Set<number>(wb.prompts.map((pr: any, i: number) => (pr.views.includes(pool) ? i : -1)).filter((i: number) => i >= 0));
    const rows = wb.facts.filter((r: any) => promptsIn.has(r[1]));
    if (!rows.length) continue;
    for (const [dataId, factMeasure, subj] of PAIRS) {
      const dm = DATA_MEASURES.get(dataId);
      if (!dm || (dm.only && !dm.only.includes(pool as any))) continue;
      const subjects = subj === "brand" ? sampleBrands : [subj];
      for (const sb of subjects) {
        let fact: any;
        try {
          fact = book.fact(factMeasure, sb === "you" ? "you" : sb, scope);
        } catch {
          continue; // not legal on this pool in the fact layer: nothing to compare
        }
        let k = 0;
        let n = 0;
        const bi = sb === "ai" || sb === "rival" || sb === "you" ? brandIdx.get(T) : brandIdx.get(sb);
        if (bi === undefined) continue;
        for (const r of rows) {
          const v = dm.calc(r, { target: brandIdx.get(T) as number, brands: new Set([bi as number]), arg: -1, prompt: { views: wb.prompts[r[1]].views, rival: wb.prompts[r[1]].rival } });
          if (v === null) continue;
          n++;
          k += v;
        }
        crossChecked++;
        if (k === fact.k && n === fact.n) crossEqual++;
        else if (dataId === "mentioned" && rawOrderNamed(sb, scope) === k) {
          crossKnown++;
        } else local.unexplained.push(`Data page ${pool} ${dataId} (${sb === T ? "you" : set.nameOf(sb)}): ${k}/${n} vs fact ${fact.id} ${fact.k}/${fact.n} (${printWhole(fact.k, fact.n)})`);
      }
    }
  }

  /* ---------- sentence numbers: numbers inside sentences that carry no counts ---------- */
  // Not facts (the statements layer will cite them): each either equals - same printed text, same card - a number
  // elsewhere on that card that IS a covered fact, or it does not (the statements layer's input, by path prefix).
  const sent = { matched: 0, unmatched: new Map<string, number>() };
  for (const st of sentenceStats) {
    const at = st.id.indexOf("::");
    const dest = st.id.slice(0, at);
    if (coveredText.get(dest)?.has(st.value)) {
      sent.matched++;
      continue;
    }
    const k2 = group(dest, st.id.slice(at + 2).split("/").map(unseg));
    sent.unmatched.set(k2, (sent.unmatched.get(k2) ?? 0) + 1);
  }
  const unmatchedN = [...sent.unmatched.values()].reduce((a, b) => a + b, 0);
  totals.sentMatched += sent.matched;
  totals.sentUnmatched += unmatchedN;
  for (const [k, v] of sent.unmatched) totals.sentByPrefix.set(k, (totals.sentByPrefix.get(k) ?? 0) + v);

  /* ---------- report ---------- */
  totals.compared += local.compared;
  totals.equal += local.equal;
  totals.unexplained += local.unexplained.length;
  for (const [k, v] of local.explained) totals.explained.set(k, (totals.explained.get(k) ?? 0) + v);
  // The gap, by why: sentence numbers (no counts - the statements layer), the average competitor (a selection,
  // layer 3), product names (no product grouping in layer 1 yet), anything else (a real gap).
  const why = (g: string) => (/no counts\)/.test(g) ? "sentence numbers (no counts)" : /layer 3\)/.test(g) ? "average competitor (layer 3)" : /product names/.test(g) ? "product names (no product grouping in layer 1)" : "other (not mapped)");
  const byWhy = new Map<string, Map<string, number>>();
  for (const [k, v] of local.notCovered) {
    const w = why(k);
    const m = byWhy.get(w) ?? new Map<string, number>();
    m.set(k.replace(/ \((sentence number, no counts|average competitor: a selection, layer 3|[^)]*product names[^)]*)\)$/, ""), v);
    byWhy.set(w, m);
    totals.notCoveredBy.set(w, (totals.notCoveredBy.get(w) ?? 0) + v);
  }
  const notCovered = [...local.notCovered.values()].reduce((a, b) => a + b, 0);
  totals.notCovered += notCovered;
  console.log(`\n== ${brand}: ${reg.all().length} registry stats, ${set.facts.length} answer facts (${set.facts.filter((f) => f.conds !== null).length} carrying decision rules; condition rows ${themed ? "themed" : "not themed"})`);
  console.log(`   compared ${local.compared}: equal ${local.equal}, explained ${[...local.explained.values()].reduce((a, b) => a + b, 0)}, unexplained ${local.unexplained.length}`);
  for (const [k, v] of local.explained) console.log(`     explained ${v} - ${k}`);
  console.log(`   not covered: ${notCovered}`);
  for (const [w, m] of byWhy) {
    console.log(`     ${String([...m.values()].reduce((a, b) => a + b, 0)).padStart(5)}  ${w}`);
    for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1])) console.log(`       ${String(v).padStart(5)}  ${k}`);
  }
  console.log(`   sentence numbers (no counts): ${sentenceStats.length} - ${sent.matched} equal a covered fact's printed number on the same card, ${unmatchedN} do not:`);
  for (const [k, v] of [...sent.unmatched.entries()].sort((a, b) => b[1] - a[1])) console.log(`       ${String(v).padStart(5)}  ${k}`);
  for (const u of local.unexplained.slice(0, 25)) console.log(`   UNEXPLAINED ${u}`);
  if (local.unexplained.length > 25) console.log(`   ... ${local.unexplained.length - 25} more unexplained`);
  failures.push(...local.unexplained.map((u) => `${brand}: ${u}`));
}

console.log(`\nAll trackers: compared ${totals.compared}, equal ${totals.equal}, explained ${[...totals.explained.values()].reduce((a, b) => a + b, 0)}, unexplained ${totals.unexplained}; not covered ${totals.notCovered}`);
for (const [k, v] of totals.explained) console.log(`  explained ${v} - ${k}`);
for (const [k, v] of totals.notCoveredBy) console.log(`  not covered ${v} - ${k}`);
console.log(`Sentence numbers (no counts): ${totals.sentMatched + totals.sentUnmatched} - ${totals.sentMatched} equal a covered fact's printed number on the same card, ${totals.sentUnmatched} do not; unmatched by path prefix:`);
for (const [k, v] of [...totals.sentByPrefix.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
{
  const { MEASURES } = await import(ROOT + "/src/lib/engine/facts/measure_book.ts");
  console.log(`Card stats compared per measure: ${[...byMeasure.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  const unused = MEASURES.map((m: any) => m.id).filter((id: string) => !byMeasure.has(id));
  console.log(`Measures with no card stat to compare against (exercised only by the Data page cross-check, or not at all): ${unused.join(", ")}`);
}
console.log(movesLoaded ? `RULING_MOVES: ${movesConfirmed} ruling explanations checked against the measured moves (the move's "after" counts equal the fact, or the stat is listed as moved)` : `RULING_MOVES raw data not found at ${MOVES_PATH} - explanations not checked against it`);
console.log(`Data page cross-check: ${crossChecked} figures recomputed from its own fact table: ${crossEqual} equal to the fact, ${crossKnown} differ by the known resolver-order fault (inventory section 5 #1, the Hulu case: reproduced by a resolver that meets names in stored order)`);
if (DUMP) fsMod.writeFileSync(DUMP, dumpRows.join("\n"));
if (process.env.FACT_FAIL) fsMod.writeFileSync(process.env.FACT_FAIL, failures.join("\n"));
console.log(failures.length ? `\n${failures.length} FAIL (unexplained)` : "\nALL PASS - every compared stat is equal or explained");
process.exit(failures.length ? 1 : 0);
