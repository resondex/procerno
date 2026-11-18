/**
 * Conditions in the answer record (fact layer, layer 1): every coded decision rule an answer states, with the
 * condition GROUP it falls in and its reason THEME - read once per run from the run's saved grouping and theme
 * assignment, exactly as the cards read them today. Nothing here groups or themes anything: it reads the results.
 *
 * Where each unit comes from (the cards read the same):
 *  - "g:<group id>"     the rules explorer's group (one condition grouping per run, scope "rules"; run_themes.ts
 *                       sharedRules). A rule whose group did not make the explorer's list (too few answers, or past
 *                       its cap) has no group and no theme - the cards never see it either.
 *  - "t:<side>:<n>"     the reason theme a group's wording falls in for the answer's buying situation
 *                       (run_themes.ts sharedRunThemes: totOf[stOf(situation, group label)]), on the toward side
 *                       (groups routing to the tracker) or the away side (groups routing to another active brand).
 *                       A group on the "elsewhere" side (a destination that is no active brand) has no theme; its
 *                       group unit is the row (the cards' themedConds puts it beside the away themes).
 *  - "m:<side>:<hash>"  the Map's own grouping (scope "analysis_map"): the cards read it for the both-ways pairs and
 *                       when a run has no themes.
 *  - "p:<side>:<hash>"  the Map's grouping of Premium vs basic rules by the end they choose (premium = toward,
 *                       basic = away) - read by the proofs only (today's card).
 *  - "q:<side>:<hash>"  the Premium vs basic card's condition rows (ruling 14): its rules by the end they choose,
 *                       grouped on the run's ONE condition grouping (the rules explorer's condition keys - the key
 *                       RuleGroup.cond hashes). The reason themes are sided by brand, so they cannot serve here.
 *
 * FOUND, for Tyler: the cards read TWO saved condition groupings of the same run (scope "rules" for the themed rows,
 * scope "analysis_map" for the both-ways pairs and the Premium vs basic rows). Both are read here as saved; which one
 * is THE grouping is a ruling to make before the cards move onto this layer.
 *
 * One statement per (answer, unit): two rules of one answer in the same unit are one statement (their
 * destinations and products merged), so every condition count is at answer grain.
 *
 * Reads saved groupings only. With an OpenAI key present it refuses, because the Map grouping read would group the
 * run afresh when no saved grouping exists (a model call) - this layer is beside the code and runs keyless.
 */
import { createHash } from "node:crypto";
import { conditionKeysFor, isDefaultCondition } from "../condition_groups";
import { excludedWords } from "../definition_overlap";
import { EVERY_BUYER, slKey } from "../reason_themes";
import { ENUM_TOWARD, GENERIC_AWAY } from "../rules_explorer";
import { sharedRunThemes } from "../run_themes";
import { condCache, type ViewData } from "../view_data";
import type { Resolved } from "../brand_resolve";
import type { AnswerFact, AnswerFactSet } from "./answer_facts";

export type CondSide = "toward" | "away";

export interface CondStmt {
  /** The unit the statement falls in (see the file header). */
  unit: string;
  grouping: "group" | "theme" | "map" | "tier";
  side: CondSide;
  /** The unit's name: a theme's name, a group's label; the Map's and the tier units carry the answer's wording (their
   * names depend on which answers a card counts - a card names the unit by its most stated wording). */
  label: string;
  /** The answer's own wording of it (the first rule's). */
  said: string;
  /** The active brands its rules send the buyer to, by name and by entry id (away side). */
  to: string[];
  toKeys: string[];
  /** The products its rules name, as written, and the active brand each sends to (away) or null. */
  cards: string[];
  cardTo: (string | null)[];
  /** The rules explorer groups the statement comes from (a theme statement can merge several). */
  groups: string[];
  /** On a group statement: the theme unit its wording falls in for this answer's buying situation (null = none). */
  theme: string | null;
  /** The run's condition keys (rules explorer RuleGroup.cond - one grouping per run, ruling 14) its groups carry: the
   * same key on the other side is the same condition stated for the other side. Empty on the Map's own units. */
  keys: string[];
}

const shortHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 10);

/** One rule's side by its schema's choice vocabulary - the Map's rule (analysis_map.ts ruleSide / ruleTo / ruleCard). */
function mapRule(rule: { choice: string; product?: string }, schema: string, resolve: (n: string) => Resolved, targetKey: string) {
  const choice = rule.choice.trim();
  const product = rule.product?.trim();
  let r: Resolved | null = null;
  let side: "you" | "away";
  if (schema === "choice" || schema === "expansion" || schema === "ecosystem" || schema === "premium") {
    if (schema === "premium" && !product) side = "away";
    else {
      r = resolve(schema === "premium" ? product! : choice);
      side = r.key === targetKey ? "you" : "away";
    }
  } else if (product) {
    r = resolve(product);
    side = r.key === targetKey ? "you" : "away";
  } else if (ENUM_TOWARD.has(choice)) side = "you";
  else if (GENERIC_AWAY[choice]) side = "away";
  else {
    r = resolve(choice);
    side = r.key === targetKey ? "you" : "away";
  }
  const to = side === "away" && r && r.status === "active" && r.key !== targetKey ? { name: r.name, key: r.key } : null;
  const card = schema === "choice" || schema === "expansion" || schema === "ecosystem" ? choice : product ? product : ENUM_TOWARD.has(choice) ? "" : GENERIC_AWAY[choice] ?? choice;
  return { side, to, card };
}

/**
 * Fills `conds` on every answer of the set that carries decision rules (null stays null: the schema asks none, or a
 * source from before rules). Returns whether the run's theme maps exist (the cards' themed path).
 */
export async function attachConditions(set: AnswerFactSet, data: ViewData, opts: { map?: boolean } = {}): Promise<{ themed: boolean }> {
  // Ruling 14: one grouping per run. `map: false` reads only the run-wide grouping and themes (what the map compute
  // itself reads, so it adds no model call); the Map's own grouping (step 2) is read only by the proofs, keyless.
  const withMap = opts.map !== false;
  if (withMap && process.env.OPENAI_API_KEY) throw new Error("fact layer: attachConditions reads saved condition groupings only and runs keyless (it would group afresh when none is saved)");
  const byId = new Map<string, AnswerFact>(set.facts.map((f) => [f.responseId, f]));
  const codeById = new Map(data.codes.map((c) => [c.response_id, c]));
  const stmts = new Map<string, Map<string, CondStmt>>();
  const add = (rid: string, s: Omit<CondStmt, "toKeys" | "groups" | "theme" | "keys"> & { toKeys?: string[]; groups?: string[]; theme?: string | null; keys?: string[] }) => {
    if (!byId.has(rid)) return;
    let m = stmts.get(rid);
    if (!m) stmts.set(rid, (m = new Map()));
    const prev = m.get(s.unit);
    const toKeys = s.toKeys ?? s.to.map((n) => set.resolve(n).key);
    if (!prev) {
      m.set(s.unit, { ...s, to: [...s.to], toKeys: [...toKeys], cards: [...s.cards], cardTo: [...s.cardTo], groups: [...(s.groups ?? [])], theme: s.theme ?? null, keys: [...(s.keys ?? [])] });
      return;
    }
    for (const g of s.groups ?? []) if (!prev.groups.includes(g)) prev.groups.push(g);
    for (const k of s.keys ?? []) if (!prev.keys.includes(k)) prev.keys.push(k);
    s.to.forEach((n, i) => {
      if (!prev.to.includes(n)) {
        prev.to.push(n);
        prev.toKeys.push(toKeys[i]);
      }
    });
    s.cards.forEach((c, i) => {
      if (!prev.cards.includes(c)) {
        prev.cards.push(c);
        prev.cardTo.push(s.cardTo[i] ?? null);
      }
    });
  };

  // 1. The rules explorer's groups and the run's themes (the cards' themed rows).
  const rt = await sharedRunThemes(data, {});
  const { rules } = rt;
  const themed = !!(rt.toward && rt.away);
  const inPool = new Map<string, "toward" | "away">();
  for (const g of rt.towardPool) inPool.set(g.id, "toward");
  for (const g of rt.awayPool) inPool.set(g.id, "away");
  for (const g of rules.rules.groups) {
    const said = rules.answerRules.get(g.id);
    if (!said) continue;
    const side: CondSide = g.side === "you" ? "toward" : "away";
    const pool = inPool.get(g.id);
    const tm = pool === "toward" ? rt.toward : pool === "away" ? rt.away : null;
    for (const [rid, ar] of said) {
      const base = { said: ar.said.trim(), to: ar.to, cards: ar.cards ?? [], cardTo: ar.cardTo ?? [] };
      const st = tm && pool ? tm.stOf.get(slKey(rt.sitOf.get(ar.intent) ?? EVERY_BUYER, g.label)) : undefined;
      const theme = st !== undefined && tm && pool ? `t:${pool}:${tm.totOf[st]}` : null;
      add(rid, { unit: `g:${g.id}`, grouping: "group", side, label: g.label, ...base, groups: [g.id], theme, keys: [g.cond] });
      if (theme && tm && st !== undefined) add(rid, { unit: theme, grouping: "theme", side: pool!, label: tm.totName[tm.totOf[st]], ...base, groups: [g.id], keys: [g.cond] });
    }
  }

  // 1b. Premium vs basic (ruling 14): rules by the end they choose, on the run-wide condition keys.
  for (const f of set.facts) {
    if (f.type !== "premium_worth") continue;
    const c = codeById.get(f.responseId);
    for (const rule of c?.decision_rules ?? []) {
      const w = rule.condition.trim();
      const tier = rule.choice.trim() === "premium" ? "toward" : rule.choice.trim() === "basic" ? "away" : null;
      if (!w || !tier) continue;
      const ck = shortHash(rules.condKeyOf(w));
      const m = mapRule(rule, c!.schema, set.resolve, set.target.key);
      const prod = rule.product?.trim() ?? "";
      // The rows name a destination only on the basic side (as the card always has).
      const tTo = tier === "away" && m.to ? [m.to.name] : [];
      const tKeys = tier === "away" && m.to ? [m.to.key] : [];
      add(f.responseId, { unit: `q:${tier}:${ck}`, grouping: "tier", side: tier, label: w, said: w, to: tTo, toKeys: tKeys, cards: prod ? [prod] : [], cardTo: prod ? [tTo[0] ?? null] : [], keys: [ck] });
    }
  }

  // 2. The Map's grouping (both-ways pairs, Premium vs basic rows), read from its saved key map (proofs only).
  if (withMap) await attachMapUnits();
  async function attachMapUnits() {
  const counts = new Map<string, number>();
  for (const f of set.facts) {
    const c = codeById.get(f.responseId);
    for (const rule of c?.decision_rules ?? []) {
      const w = rule.condition.trim();
      if (w) counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  const exclude = excludedWords([data.project.category]);
  const keys = await conditionKeysFor(counts, () => counts, exclude, { large: true, cache: condCache(data, "analysis_map") });
  for (const f of set.facts) {
    const c = codeById.get(f.responseId);
    if (!c?.decision_rules) continue;
    for (const rule of c.decision_rules) {
      const w = rule.condition.trim();
      if (!w) continue;
      const ck = shortHash(keys.get(w)!);
      const m = mapRule(rule, c.schema, set.resolve, set.target.key);
      const to = m.to ? [m.to.name] : [];
      const toKeys = m.to ? [m.to.key] : [];
      add(f.responseId, { unit: `m:${m.side === "you" ? "toward" : "away"}:${ck}`, grouping: "map", side: m.side === "you" ? "toward" : "away", label: w, said: w, to, toKeys, cards: m.card ? [m.card] : [], cardTo: m.card ? [m.to?.name ?? null] : [] });
      if (f.type === "premium_worth") {
        const tier = rule.choice.trim() === "premium" ? "toward" : rule.choice.trim() === "basic" ? "away" : null;
        const prod = rule.product?.trim() ?? "";
        // The Premium vs basic rows name a destination only on the basic side (the Map's groupsOf).
        const tTo = tier === "away" ? to : [];
        const tKeys = tier === "away" ? toKeys : [];
        if (tier) add(f.responseId, { unit: `p:${tier}:${ck}`, grouping: "tier", side: tier, label: w, said: w, to: tTo, toKeys: tKeys, cards: prod ? [prod] : [], cardTo: prod ? [tTo[0] ?? null] : [] });
      }
    }
  }
  }

  for (const f of set.facts) {
    const c = codeById.get(f.responseId);
    f.conds = c?.decision_rules == null ? null : [...(stmts.get(f.responseId)?.values() ?? [])];
  }
  return { themed };
}

/** A unit's statements are a card row's only when the row is not the default clause ("otherwise"). */
export const isDefaultUnitLabel = (label: string) => isDefaultCondition(label);
