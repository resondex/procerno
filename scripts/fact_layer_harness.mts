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
 *  - stats that no measure covers yet are counted by path prefix (the gap to full coverage);
 *  - a sample of the Data page's measures (workbench.ts facts + measures.ts definitions) is recomputed from its own
 *    fact table and compared with the same fact.
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

const totals = { compared: 0, equal: 0, explained: new Map<string, number>(), unexplained: 0, notCovered: 0 };
const failures: string[] = [];
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
            label: "known conflict, no ruling yet (inventory 3 #8: the card counts a 'none' tier stance as balanced)",
            kind: "known",
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
      if (m === "recommended_no_pick") {
        // Ruling 8: every pick sits in one bucket; today's "no single pick" also counts picks outside the category.
        const key = s === "you" ? T : s;
        const fold = (x: Scope) => countWith(x, (f) => f.brands.some((nb: any) => nb.key === key && nb.recommended), (f) => f.pick.state !== "in_analysis");
        alts.push({ label: "ruling 8 as read here (a pick outside the category is its own bucket, so not 'no single pick'; today's card folds it in - RULING_MOVES did not measure this reading)", kind: "ruling", calc: () => fold(sc) });
        if (td) alts.push({ label: "ruling 7 + ruling 8 as read here (today's four-type pool, and 'no single pick' folding in picks outside the category)", kind: "ruling", moves: { ruling: "R7", check: "listed" }, calc: () => fold(td) });
      }
      return spec(m, s, sc, alts);
    };

    if (p[0] === "detail") {
      const [, step, what, a, b] = p;
      if (what === "row" && step === "named") {
        if (b === "rival" && !R) return { group: `${g} (average competitor: a selection, layer 3)` };
        const s = b === "you" ? "you" : R!;
        if (a === "Named but not recommended") return spec("named_not_recommended", s, scope, ruling7("named_not_recommended", s, today));
        if (/^Of those, named as .* to avoid$/.test(a)) return spec("negative_when_named_not_recommended", s, scope, ruling7("negative_when_named_not_recommended", s, today));
        return { group: g };
      }
      if (what === "outcome" && step === "converts") {
        if (a === "Average competitor") return { group: `${g} (average competitor: a selection, layer 3)` };
        // "Here" is you in this cell; "All buyers" / "All rivals' customers" is you on the row's All cell (the usual).
        const usualRow = a === "All buyers" || a === "All rivals' customers";
        const s = a === "You" || a === "Here" || usualRow ? "you" : keyOf(a);
        if (usualRow) {
          const u = rowAllScope(cellId);
          return u ? mapOutcome(b, s, u.scope, u.today) : { group: g };
        }
        return mapOutcome(b, s, scope, today);
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
        return { group: `${g}/${title.replace(/^(Which|What|Where|How|Who) .*/, "$1 ...")}` };
      }
      return { group: g };
    }

    if ((p[0] === "table" && p[1] === "What these answers cover") || (p[0] === "tables" && p[1] === "What the answer weighs")) {
      if (p[3] !== "0") return { group: g };
      const code = codeOf(p[2]);
      return code ? spec("argues", `ai/arg:${code}`, scope) : { group: g };
    }

    if (p[0] === "byProduct") {
      const m = ["worth_yes", "worth_depends", "worth_no"][Number(p[3])];
      return m ? spec(m, "ai", { ...scope, line: p[2] }) : { group: g };
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
  for (const stat of reg.all()) {
    const mapped = mapStat(stat);
    if ("group" in mapped) {
      local.notCovered.set(mapped.group, (local.notCovered.get(mapped.group) ?? 0) + 1);
      continue;
    }
    const { m, s, scope, alts } = mapped.spec;
    local.compared++;
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
    else local.unexplained.push(`${stat.id} = ${stat.value} (${stat.k}/${stat.n}); fact ${f.id} = ${f.text} (${f.k}/${f.n})`);
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

  /* ---------- report ---------- */
  totals.compared += local.compared;
  totals.equal += local.equal;
  totals.unexplained += local.unexplained.length;
  for (const [k, v] of local.explained) totals.explained.set(k, (totals.explained.get(k) ?? 0) + v);
  const notCovered = [...local.notCovered.values()].reduce((a, b) => a + b, 0);
  totals.notCovered += notCovered;
  console.log(`\n== ${brand}: ${reg.all().length} registry stats, ${set.facts.length} answer facts`);
  console.log(`   compared ${local.compared}: equal ${local.equal}, explained ${[...local.explained.values()].reduce((a, b) => a + b, 0)}, unexplained ${local.unexplained.length}`);
  for (const [k, v] of local.explained) console.log(`     explained ${v} - ${k}`);
  console.log(`   not covered by any measure yet: ${notCovered}`);
  for (const [k, v] of [...local.notCovered.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(5)}  ${k}`);
  for (const u of local.unexplained.slice(0, 25)) console.log(`   UNEXPLAINED ${u}`);
  if (local.unexplained.length > 25) console.log(`   ... ${local.unexplained.length - 25} more unexplained`);
  failures.push(...local.unexplained.map((u) => `${brand}: ${u}`));
}

console.log(`\nAll trackers: compared ${totals.compared}, equal ${totals.equal}, explained ${[...totals.explained.values()].reduce((a, b) => a + b, 0)}, unexplained ${totals.unexplained}; not covered ${totals.notCovered}`);
for (const [k, v] of totals.explained) console.log(`  explained ${v} - ${k}`);
{
  const { MEASURES } = await import(ROOT + "/src/lib/engine/facts/measure_book.ts");
  console.log(`Card stats compared per measure: ${[...byMeasure.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  const unused = MEASURES.map((m: any) => m.id).filter((id: string) => !byMeasure.has(id));
  console.log(`Measures with no card stat to compare against (exercised only by the Data page cross-check, or not at all): ${unused.join(", ")}`);
}
console.log(movesLoaded ? `RULING_MOVES: ${movesConfirmed} ruling explanations checked against the measured moves (the move's "after" counts equal the fact, or the stat is listed as moved)` : `RULING_MOVES raw data not found at ${MOVES_PATH} - explanations not checked against it`);
console.log(`Data page cross-check: ${crossChecked} figures recomputed from its own fact table: ${crossEqual} equal to the fact, ${crossKnown} differ by the known resolver-order fault (inventory section 5 #1, the Hulu case: reproduced by a resolver that meets names in stored order)`);
console.log(failures.length ? `\n${failures.length} FAIL (unexplained)` : "\nALL PASS - every compared stat is equal or explained");
process.exit(failures.length ? 1 : 0);
