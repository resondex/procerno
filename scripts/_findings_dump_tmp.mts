/**
 * THROWAWAY (do not commit): zero-spend findings data dump for report writers.
 *
 *   npx tsx scripts/_findings_dump_tmp.mts [outDir]
 *
 * Fixture ONLY - env set before any src import (analysis_map_harness pattern):
 * DATABASE_URL blanked, SQLITE_PATH = data/dashboard_fixture.db, every API key
 * blanked, RUN_COLLECT_ONLY=1. Calls the pure computes directly (no cachedView),
 * so nothing is written to the store. Writes one JSON per tracker.
 */
process.env.DATABASE_URL = "";
// SQLITE_PATH may point at another LOCAL replica (e.g. the Sephora extract); unset = the fixture.
process.env.SQLITE_PATH = process.env.SQLITE_PATH || process.cwd() + "/data/dashboard_fixture.db";
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";
process.env.RUN_COLLECT_ONLY = "1";

const fs = await import("node:fs");
const path = await import("node:path");
const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const VD = await import(process.cwd() + "/src/lib/engine/view_data.ts");
const { computeAnalysisMap } = await import(process.cwd() + "/src/lib/engine/analysis_map.ts");
const { computeBrandSummary } = await import(process.cwd() + "/src/lib/engine/brand_summary.ts");
const { computeHeadToHead } = await import(process.cwd() + "/src/lib/engine/head_to_head.ts");
const { computeAlternatives } = await import(process.cwd() + "/src/lib/engine/alternatives.ts");
const { computeDoubt } = await import(process.cwd() + "/src/lib/engine/doubt.ts");
const { computeValue } = await import(process.cwd() + "/src/lib/engine/value.ts");
const { computeReasons } = await import(process.cwd() + "/src/lib/engine/reasons.ts");
const { computeHeadline } = await import(process.cwd() + "/src/lib/engine/headline.ts");
const { computeAwareness } = await import(process.cwd() + "/src/lib/engine/awareness.ts");
const { buildResolver } = await import(process.cwd() + "/src/lib/engine/brand_resolve.ts");
const { viewsOf } = await import(process.cwd() + "/src/lib/engine/views.ts");
const { ENGINES, engineDisplayLabel, engineFacets } = await import(process.cwd() + "/src/lib/engine/providers.ts");

const OUT =
  process.argv[2] ??
  "/private/tmp/claude-501/-Users-tylersolloway-Documents-GitHub-procerno/4240dd23-9cae-44fd-bdfd-aa5e046d322c/scratchpad/findings_dump";
fs.mkdirSync(OUT, { recursive: true });

type KN = { k: number; n: number; pct: number | null };
const kn = (k: number, n: number): KN => ({ k, n, pct: n > 0 ? Math.round((k / n) * 10000) / 100 : null });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** One open-choice answer, resolved like brand_summary.factsOf. */
interface F {
  model: string;
  room: string | null;
  cellId: string;
  cellText: string;
  outcome: string | null;
  pick: string | null; // active brand key
  inCat: boolean;
  named: Set<string>;
  rec: Set<string>;
  reasons: string[] | null;
}

const projects = (await store.listProjects()).filter((p: { archived_at?: string | null }) => !p.archived_at);
const spot: string[] = [];

for (const project of projects) {
  const runs = await store.listRuns(project.id);
  const run = runs[0];
  if (!run) continue;
  const data = await VD.loadViewData(run, project, { setupDecision: true, codeGroups: true, judge: true });
  if (!data) {
    console.log(`skip ${project.brand}: no codes source`);
    continue;
  }
  console.log(`== ${project.brand} (${data.codes.length} codes)`);
  const resolve = buildResolver(data.dictionary, data.judged);
  const targetKey = resolve(project.brand).key;
  const entryByKey = new Map(data.dictionary.map((e: { id: string }) => [e.id, e]));
  const nameOf = (key: string) => {
    if (key === targetKey) return project.brand;
    const e = entryByKey.get(key) as { display_name?: string | null; canonical: string } | undefined;
    return e ? e.display_name ?? e.canonical : key;
  };

  // ---------- 1. meta ----------
  const core = [...VD.corePanel(data)];
  const engineMeta = new Map(ENGINES.map((e: { id: string; label: string; mode: string }) => [e.id, e]));
  const engines = core.map((id) => {
    const e = engineMeta.get(id);
    return { id, label: e ? engineDisplayLabel(e) : id, ...engineFacets(id), answers: data.responses.filter((r: { model: string | null }) => (r.model ?? run.model) === id).length };
  });
  const meta = {
    brand: project.brand,
    category: project.category,
    project_id: project.id,
    run_id: run.id,
    run_status: run.status,
    codes_source: data.source,
    answers_collected: data.responses.length,
    answers_coded: data.codes.length,
    engines,
  };

  // ---------- 2-4. views ----------
  const debug = { walls: [], casting: {} } as unknown as Parameters<typeof computeAnalysisMap>[2] & object;
  const map = await computeAnalysisMap(data, {}, debug);
  for (const p of Object.values(map.positions) as { receipts: unknown[]; toward: unknown[]; away: unknown[] }[]) {
    p.receipts = p.receipts.slice(0, 3);
    p.toward = p.toward.slice(0, 10);
    p.away = p.away.slice(0, 10);
  }
  const summary = await computeBrandSummary(data, {});
  const h2h = await computeHeadToHead(data, {});
  const alts = computeAlternatives(data, {});
  const doubt = computeDoubt(data, {});
  const value = computeValue(data, {});
  const reasons = computeReasons(data, {});
  const headline = computeHeadline(data, {});
  const awareness = await computeAwareness(data, {});
  // Trim condition groups (top 10 per side) and sample ids.
  for (const v of [h2h.entity, h2h.class]) {
    if (!v) continue;
    for (const r of v.rows) {
      const c = r.conditions;
      if (!c) continue;
      c.you = c.you.slice(0, 10).map((g: { label: string; n: number; ids: string[] }) => ({ ...g, ids: g.ids.slice(0, 3) }));
      c.rival = c.rival.slice(0, 10).map((g: { label: string; n: number; ids: string[] }) => ({ ...g, ids: g.ids.slice(0, 3) }));
      c.elsewhere = c.elsewhere.slice(0, 8).map((e: { name: string; n: number; conditions: { label: string; n: number; ids: string[] }[] }) => ({
        ...e,
        conditions: e.conditions.slice(0, 5).map((g) => ({ ...g, ids: g.ids.slice(0, 2) })),
      }));
    }
  }

  // ---------- open-choice facts ----------
  const { rows: openRows } = VD.poolOf(data, "headline", {});
  const facts: F[] = openRows.map(({ code: c, intent, model }: { code: any; intent: any; model: string }) => {
    const named = new Set<string>();
    const rec = new Set<string>();
    for (const m of c.mentions ?? []) {
      const r = resolve(m.brand);
      if (r.status !== "active") continue;
      named.add(r.key);
      if (m.framing === "recommended") rec.add(r.key);
    }
    let pick: string | null = null;
    let inCat = false;
    if (c.outcome === "pick" && c.top_pick) {
      const r = resolve(c.top_pick);
      if (r.status === "active") {
        pick = r.key;
        inCat = true;
        named.add(r.key);
        rec.add(r.key);
      }
    }
    return { model, room: intent.situation, cellId: intent.id, cellText: intent.text, outcome: c.outcome, pick, inCat, named, rec, reasons: c.reasons };
  });
  const brandKeys: string[] = summary.brands.map((b: { key: string }) => b.key);

  const groupStats = (list: F[], withBrands = true) => {
    const decided = list.filter((f) => f.inCat).length;
    const out: Record<string, unknown> = {
      answers: list.length,
      decided,
      target_named: kn(list.filter((f) => f.named.has(targetKey)).length, list.length),
      target_chosen: kn(list.filter((f) => f.pick === targetKey).length, list.length),
      target_share_of_decided: kn(list.filter((f) => f.pick === targetKey).length, decided),
    };
    if (withBrands)
      out.brand_share_of_decided = Object.fromEntries(
        brandKeys.map((k) => [nameOf(k), kn(list.filter((f) => f.pick === k).length, decided)]).filter(([, v]) => (v as KN).k > 0)
      );
    return out;
  };

  // ---------- 5. engine groups ----------
  const facetOf = (m: string) => engineFacets(m);
  const groupBy = (keyOf: (m: string) => string) => {
    const keys = [...new Set(core.map(keyOf))];
    return Object.fromEntries(
      keys.map((k) => [k, { engines: core.filter((m) => keyOf(m) === k), ...groupStats(facts.filter((f) => keyOf(f.model) === k)) }])
    );
  };
  const engine_groups = {
    note: "Open-choice (headline) pool on the core panel. share_of_decided = picks of the brand / in-category firm picks.",
    mode: groupBy((m) => facetOf(m).mode),
    vendor: groupBy((m) => facetOf(m).vendor),
    tier: groupBy((m) => facetOf(m).tier),
    engine: Object.fromEntries(core.map((m) => [m, { label: engines.find((e) => e.id === m)?.label, ...facetOf(m), ...groupStats(facts.filter((f) => f.model === m)) }])),
  };

  // ---------- 6. rooms ----------
  const roomList = [...new Set(facts.map((f) => f.room).filter((r): r is string => !!r))];
  const valueRoomOf = (room: string) => value?.rooms.find((r: { rooms: string[] }) => r.rooms.includes(room)) ?? null;
  const awRoom = (room: string) =>
    awareness?.routing?.rooms.find((r: { key: string; label: string }) => r.key === room || r.label === room) ?? null;
  const rooms = roomList.map((room) => {
    const list = facts.filter((f) => f.room === room);
    const s = groupStats(list, false) as Record<string, unknown> & { decided: number };
    const top = brandKeys
      .map((k) => ({ brand: nameOf(k), target: k === targetKey, share: kn(list.filter((f) => f.pick === k).length, s.decided) }))
      .filter((b) => b.share.k > 0)
      .sort((a, b) => b.share.k - a.share.k)
      .slice(0, 8);
    const vr = valueRoomOf(room);
    const aw = awRoom(room);
    return {
      room,
      ...s,
      top_brands_share_of_decided: top,
      value_row: vr
        ? { line: vr.line, counterpart: vr.counterpart, answers: vr.answers, worth: vr.worth, ownRung: vr.ownRung, recommendsInstead: vr.recommendsInstead, instead: vr.instead }
        : null,
      awareness_problem_recognition: aw
        ? { answers: aw.answers, recommendsYou: aw.recommendsYou, namesYou: aw.namesYou, routed: aw.routed, pointsToProducts: aw.pointsToProducts }
        : null,
    };
  });
  // Room-invariant pools: answers per view whose cell has no situation.
  const intentById = new Map(data.intents.map((i: { id: string }) => [i.id, i]));
  const invariant: Record<string, number> = {};
  const roomPinned: Record<string, number> = {};
  const promptIntent = new Map(data.prompts.map((p: { id: string; intent_id: string | null }) => [p.id, p.intent_id ? intentById.get(p.intent_id) : undefined]));
  const coreSet = new Set(core);
  const codedIds = new Set(data.codes.map((c: { response_id: string }) => c.response_id));
  for (const r of data.responses) {
    if (!coreSet.has(r.model ?? run.model) || !codedIds.has(r.id)) continue;
    const it = promptIntent.get(r.prompt_id) as { stage: string; angle: string | null; situation: string | null } | undefined;
    if (!it) continue;
    for (const v of viewsOf(it.stage, it.angle)) {
      const bucket = it.situation ? roomPinned : invariant;
      bucket[v] = (bucket[v] ?? 0) + 1;
    }
  }

  // ---------- 7. brands ----------
  const entityRows = h2h.entity?.rows ?? [];
  const mainKeys = new Set<string>(entityRows.filter((r: { resolved: boolean }) => r.resolved).map((r: { key: string }) => r.key));
  for (const b of summary.brands) if (b.key !== targetKey && b.shareOfDecided.n > 0 && b.shareOfDecided.k / b.shareOfDecided.n > 0.05) mainKeys.add(b.key);
  const otherCatPicks = (k: string) => facts.filter((f) => f.inCat && f.pick !== k && f.reasons !== null);
  const brands = [...mainKeys].map((key) => {
    const sb = summary.brands.find((b: { key: string }) => b.key === key);
    const decidedAll = facts.filter((f) => f.inCat).length;
    const perGroup = (keyOf: (m: string) => string) =>
      Object.fromEntries(
        [...new Set(core.map(keyOf))].map((g) => {
          const list = facts.filter((f) => keyOf(f.model) === g);
          const dec = list.filter((f) => f.inCat).length;
          return [g, { answers: list.length, named: kn(list.filter((f) => f.named.has(key)).length, list.length), share_of_decided: kn(list.filter((f) => f.pick === key).length, dec) }];
        })
      );
    const hr = entityRows.find((r: { key: string }) => r.key === key);
    const leaver = alts.offensive?.rows.find((r: { key: string }) => r.key === key) ?? null;
    const exitObj = doubt.objections?.exits.find((e: { key: string }) => e.key === key) ?? null;
    const exitKeep = doubt.keepOrLeave?.exits.find((e: { key: string }) => e.key === key) ?? null;
    const destDef = alts.defensive?.destinations.find((d: { key: string }) => d.key === key) ?? null;
    // Winning arguments: this brand's picks vs other in-category picks.
    const wins = facts.filter((f) => f.pick === key && f.reasons !== null);
    const others = otherCatPicks(key);
    const codes = new Set<string>();
    for (const f of [...wins, ...others]) for (const r of f.reasons!) codes.add(r);
    const args = [...codes]
      .map((code) => {
        const w = wins.filter((f) => f.reasons!.includes(code)).length;
        const o = others.filter((f) => f.reasons!.includes(code)).length;
        return { code, in_brand_picks: kn(w, wins.length), in_other_picks: kn(o, others.length), lift_pts: wins.length && others.length ? Math.round((w / wins.length - o / others.length) * 10000) / 100 : null };
      })
      .filter((a) => a.in_brand_picks.k + a.in_other_picks.k >= 5)
      .sort((a, b) => (b.lift_pts ?? -999) - (a.lift_pts ?? -999))
      .slice(0, 10);
    return {
      key,
      name: nameOf(key),
      role: sb?.role ?? null,
      is_h2h_rival: entityRows.some((r: { key: string }) => r.key === key),
      overall: sb
        ? { named: sb.mentioned, recommended: sb.recommended, chosen: sb.chosen, share_of_decided: sb.shareOfDecided }
        : { share_of_decided: kn(facts.filter((f) => f.pick === key).length, decidedAll) },
      per_room_share_of_decided: Object.fromEntries(
        roomList.map((room) => {
          const list = facts.filter((f) => f.room === room);
          return [room, kn(list.filter((f) => f.pick === key).length, list.filter((f) => f.inCat).length)];
        })
      ),
      by_mode: perGroup((m) => facetOf(m).mode),
      by_vendor: perGroup((m) => facetOf(m).vendor),
      by_tier: perGroup((m) => facetOf(m).tier),
      h2h_vs_client: hr
        ? {
            answers: hr.answers,
            client_won: hr.won,
            rival_won: hr.lost,
            other_pick: hr.other,
            undecided: hr.undecided,
            client_two_way: hr.winOfDecided,
            other_picks: hr.otherPicks,
            conditions_routes_to_client: hr.conditions?.you ?? null,
            conditions_routes_to_rival: hr.conditions?.rival ?? null,
            conditions_more_groups: hr.conditions ? { client: hr.conditions.youMore, rival: hr.conditions.rivalMore } : null,
            unconditional_answers: hr.conditions?.unconditional ?? null,
            total_rules: hr.conditions?.rules ?? null,
          }
        : null,
      leaver_cell: leaver
        ? {
            answers: leaver.answers,
            client_named: leaver.named,
            client_recommended: leaver.recommended,
            client_captured: leaver.captured,
            another_brand: leaver.anotherBrand,
            same_brand_kept: leaver.sameBrand,
            outside: leaver.outside,
            undecided: leaver.undecided,
            captors: leaver.captors,
          }
        : null,
      as_exit: {
        objections: exitObj ? { offered: exitObj.offered, by: exitObj.by } : null,
        churn_renewal: exitKeep ? { offered: exitKeep.offered, by: exitKeep.by } : null,
        defensive_alternatives: destDef ? { offered: destDef.offered, onKeep: destDef.onKeep, onLeave: destDef.onLeave, onUndecided: destDef.onUndecided } : null,
      },
      winning_arguments: { brand_picks_with_reasons: wins.length, other_incat_picks_with_reasons: others.length, top10_by_lift: args },
    };
  });

  // ---------- 8. questions ----------
  const qmap = new Map<string, F[]>();
  for (const f of facts) qmap.set(f.cellId, [...(qmap.get(f.cellId) ?? []), f]);
  const questions = [...qmap.entries()]
    .map(([id, list]) => {
      const dec = list.filter((f) => f.inCat);
      const counts = new Map<string, number>();
      for (const f of dec) counts.set(f.pick!, (counts.get(f.pick!) ?? 0) + 1);
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      return {
        cell_id: id,
        seed: list[0].cellText,
        room: list[0].room,
        answers: list.length,
        decided: dec.length,
        target_picks: counts.get(targetKey) ?? 0,
        top_pick: ranked[0] ? { brand: nameOf(ranked[0][0]), k: ranked[0][1] } : null,
        picks: ranked.slice(0, 5).map(([k, n]) => ({ brand: nameOf(k), k: n })),
      };
    })
    .filter((q) => q.decided >= 10)
    .sort((a, b) => b.decided - a.decided);

  const out = {
    meta,
    analysis_map: { ...map, casting_facts: (debug as { casting: unknown }).casting },
    brand_summary: summary,
    views: { headline, head_to_head: h2h, alternatives: alts, doubt, value, reasons, awareness },
    engine_groups,
    rooms: { pinned: rooms, room_pinned_answer_counts_by_view: roomPinned, room_invariant_answer_counts_by_view: invariant },
    brands,
    questions,
  };
  const file = path.join(OUT, `${slug(project.brand)}.json`);
  // Size: round floats to 4 decimals everywhere; drop Wilson low/high inside
  // the reasons view (hundreds of k/n cells - k and n are enough there).
  const stripCI = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(stripCI);
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if ("k" in o && "n" in o && "low" in o && "high" in o && Object.keys(o).length === 4) return { k: o.k, n: o.n };
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, stripCI(v)]));
    }
    return x;
  };
  (out.views as Record<string, unknown>).reasons = stripCI(reasons);
  const json = JSON.stringify(out, (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 10000) / 10000 : v));
  fs.writeFileSync(file, json);
  console.log(`  wrote ${file} (${Math.round(json.length / 1024)} KB)`);

  // ---------- spot check ----------
  const t = summary.target;
  const pc = (c: { k: number; n: number }) => (c.n ? ((c.k / c.n) * 100).toFixed(1) : "-");
  const mode = engine_groups.mode as Record<string, { target_chosen: KN; target_share_of_decided: KN }>;
  const h2hLine = entityRows.map((r: { rival: string; winOfDecided: { k: number; n: number } }) => `${r.rival} ${pc(r.winOfDecided)}`).join(", ");
  spot.push(
    `${project.brand.padEnd(17)} named ${pc(t.mentioned)} chosen ${pc(t.chosen)} SoD ${pc(t.shareOfDecided)} | chosen search ${mode.search ? pc(mode.search.target_chosen) : "-"} instinct ${mode.instinct ? pc(mode.instinct.target_chosen) : "-"} | h2h two-way: ${h2hLine}`
  );
}

console.log("\nSPOT CHECK");
for (const l of spot) console.log(l);
