/* eslint-disable @typescript-eslint/no-explicit-any -- a harness over the served payloads */
/**
 * The Brief's number links (bf33): every linked number in every frame (own subject, every fixture tracker)
 * opens a card whose index (panel_index.ts) shows that number beside its subject - by default, or with exactly
 * the reveal the link carries - or is an explicit fallback to the Brief's own answer card. Unlinked numbers
 * (scoreboard competitor columns, the visibility table, chart labels, rows with no card) must exist on some card
 * or By rival card. Prints the fallback list by kind and the unlinked figures with no home.
 *
 * Stage 2 (stat ids, 2026-11-17): a number linked by its stat id (BriefLink.stat) must be exactly its registry stat
 * (same value, card and reveal) - those bypass matching; the rest are still matched (stage 3 scope, listed by kind).
 * Fails when a sentence that prints a card figure (a migrated sentence) prints any number without a stat id, and -
 * with BRIEF_BEFORE=<dump.json> (scratch dump of every Brief string before the change) - when a sentence of that
 * dump is absent now. Figures printed the old way because no card shows them are listed as "needs a card home".
 *
 * Stage 3 (funnel decisions, 2026-11-17): the run is STRICT (BRIEF_STRICT_FUNNEL=1, set below) - brief.ts strips
 * the brand summary's funnel cells and, strict, makes each a getter that throws, so every Brief computed here proves
 * no funnel path read the old source to print or to decide. Checked too: a negative control (reading a stripped
 * field throws), a source check of brief.ts (no funnel-cell reads, no per-situation headline reads, the full summary
 * reached only by the two out-of-scope calls), and the funnel universe (every summary brand has a funnel on a card).
 *
 * Stage 4 (verdict figures, 2026-11-17): Value, the worries, the customers looking around, rivals' customers switching
 * and the direct matchups are the verdict cards' stats too. brief.ts strips the verdict views (stripVerdicts) - strict,
 * a read of the summary's headToHead / buyersDoubt / customersDoubt or the inputs' value / doubt / alternatives
 * throws - and the source check fails on any read of an old verdict field outside a `legacyV` / `c.legacy` line
 * (the tagged path for a verdict figure no card shows, listed under "needs a card home").
 *
 * Stage 5 (conditions and arguments, 2026-11-17): what the AI says about the buyer (a card's condition rows) and about
 * the category (a card's "What the answer weighs" rows) are the cards' stats too - printed, linked and decided from
 * the registry's condition and weighs rows. stripVerdicts also takes the condition and argument rollups out of the
 * inputs (strict: a read of inputs.conditions / away / taught throws; the tagged paths read `c.legacyArgs`), and the
 * source check fails on any direct read of a card's condition or weighs objects, the map's per-buyer lift, the old
 * argument lift, or a share printed from a panel row's value - outside the allowed lines it names.
 *
 * statids8 (names and lists, 2026-11-17): every name the Brief states in a role a card shows - a fixed situation, who
 * takes the picks there, the condition that sends buyers away and where it sends them, the product a Value question
 * asked about, the rival a price answer names most, the checklist and a checklist topic that comes up more when another
 * brand is picked, a matchup's / rivals' customers' / a worry's own name - is read from that card (brief.ts nameOn,
 * BRIEF_NAME_LOG=1). Each logged name is checked against the card's own object (the card draws it there), and the
 * source check fails on any read of the old sources for those names (the run's away rollup, the run-wide argument lift,
 * the Map's per-cell wall and taker fields in a Brief sentence, the Value view's product lines, a matchup's or
 * rivals' customers' name from the verdict views).
 *
 * Fixture only, no model calls:  npx tsx scripts/brief_links_harness.mts
 */
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = process.cwd() + "/data/dashboard_fixture.db";
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";

const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { loadViewData } = await import(process.cwd() + "/src/lib/engine/view_data.ts");
process.env.BRIEF_TRIM_LOG = "1";
process.env.BRIEF_FIG_LOG = "1";
process.env.BRIEF_STRICT_FUNNEL = "1";
process.env.BRIEF_NAME_LOG = "1";
const { computeBrief, conditionTerms, TRIMMED_CLAIMS, FIG_LOG, NAME_LOG, stripFunnel, stripVerdicts } = await import(process.cwd() + "/src/lib/engine/brief.ts");
const { buildStatRegistry } = await import(process.cwd() + "/src/lib/engine/stat_registry.ts");
const fs = await import("node:fs");
const { sharedAnalysisMap } = await import(process.cwd() + "/src/lib/engine/analysis_map.ts");
const { sharedBrandSummary } = await import(process.cwd() + "/src/lib/engine/brand_summary.ts");
const { linkResolver, numberContext } = await import(process.cwd() + "/src/lib/engine/brief_links.ts");
const { computeWorkbench } = await import(process.cwd() + "/src/lib/engine/workbench.ts");
const { LIB_BY_ID, entrySettings, entryAvailable } = await import(process.cwd() + "/src/app/projects/[id]/table_library.ts");
const { resolveSettings, computePivot } = await import(process.cwd() + "/src/app/projects/[id]/pivot_compute.ts");

const NUMBER_TOKEN = /\d+(?:\.\d+)?%|[+-]\d+ (?:pts|points)/g;

function kindOf(s: string, row?: string): string {
  if (row) return row;
  if (/assistants (carry|pick|supply)|supply .* of (its|their) picks/i.test(s)) return "AI-company concentration";
  if (/argued in|argues .* in|comes up in .* answers that pick|bring up|comes up more|shows up when/i.test(s)) return "argument share by who is picked";
  if (/Buyers who say|sends? buyers away|that say when to choose|sent away/i.test(s)) return "condition shares";
  if (/worth (it|paying)|cheaper option|doubt(s)? (it|the price)/i.test(s)) return "value verdict shares";
  if (/worr|told to (stay|leave|go ahead)|agrees .* fair/i.test(s)) return "worry verdicts";
  if (/switch|customers ask what|customers looking/i.test(s)) return "switching";
  if (/directly|compare|matchup|straight choice/i.test(s)) return "matchup records";
  if (/recommendations (end|into)|end with it as the pick|turns .* recommendations/i.test(s)) return "conversion";
  if (/buying situation|the buyer in/i.test(s) && /pick/.test(s)) return "share of picks by buying situation";
  if (/named|recommended|commits|settles|share of picks|of the picks|pick in|is the pick/i.test(s)) return "funnel / share of picks";
  return "other";
}

const failures: string[] = [];

// Stage 3: the source check - brief.ts reads no funnel cell of the brand summary, no per-situation headline, no
// Position.brands split, and reaches the full summary only through the two out-of-scope calls.
{
  const src = fs.readFileSync(process.cwd() + "/src/lib/engine/brief.ts", "utf8");
  const bad = /\.(mentioned|chosen|shareOfDecided|firmPickInCategory|firmPick|byMode|byEngine)\b|\.recommended\b|computeHeadline|\bpos(ition)?\.brands\b/;
  src.split("\n").forEach((l, i) => {
    if (bad.test(l)) failures.push(`brief.ts:${i + 1} reads an old-source funnel field: ${l.trim().slice(0, 160)}`);
  });
  // Stage 4: no old verdict field is read except on the tagged legacy path (a figure no card shows) or where the
  // verdict views are declared and stripped to names.
  const badV = /\.captured\b|\.winOfDecided\b|\.verdicts\.(proceed|avoid|keep|leave|undecided)\b|\.worth\.(yes|no|depends)\b|\.(buyersDoubt|customersDoubt|headToHead)\b|\binputs\.(value|doubt|alternatives)\b|\bvsTarget\b|\.instead\.find\b|\.ownRung\b|\.recommendsInstead\b|\bvalueInstead\(/;
  const okV = /c\.legacy\.|legacyV\(|^type BriefSummary|SUMMARY_VERDICT_FIELDS =|const \{ target: _t,|h2h: summary\.headToHead\.map\(\(r\) => \(\{ key: r\.key, rival: r\.rival \}\)\)/;
  src.split("\n").forEach((l, i) => {
    if (badV.test(l) && !okV.test(l)) failures.push(`brief.ts:${i + 1} reads an old-source verdict field: ${l.trim().slice(0, 160)}`);
  });
  // Stage 5: no condition or argument figure is read from a card's objects or a computed rollup - only from the stat
  // registry. Allowed: comment lines, conditionTerms (the matching resolver's terms, deleted with brief_links.ts), and
  // the tagged legacy paths (`c.legacyArgs.` - the no-card conditions paragraph, the number-free fixed-situation and
  // sent-away lines, the checklist membership; `legacyLift` - the diagnosis's "points it raises most" line;
  // `legacyRoomCodes` - By buying situation's "when it picks <leader>, the answers most often argue ..."), and the
  // codebook's argument NAMES (argCodes: which weighs rows are arguments - names only, no figure or count).
  const bad5 = /\.weighsComp\b|\.weighs\b|\bpanel\?*\.conditions\b|\.conditions\?*\.(toward|away)\b|\.exception\b|\broomLift\b|\broomCodes\b|\bc\.lift\b|\bcardArgOf\b|\.share\.(value|tip)\b|\binputs\.(conditions|away|taught)\b|\blegacyArgs\b|\blegacyLift\b/;
  const ok5 = /^\s*(\/\/|\*|\/\*\*)|const sets = \[pp\?\.conditions|c\.legacyArgs\.(conditions|taught)\b|legacyArgs(: LegacyArgs|,$| \} = stripVerdicts)|legacyArgs: \{ conditions, away, taught \}|type LegacyArgs|const \{ value, doubt, alternatives, conditions, away, taught|^const BRIEF_VERSION|^\s*const argCodes = |legacyRoomCodes(: debug\.roomCodes|\?: NonNullable)/;
  src.split("\n").forEach((l, i) => {
    if (bad5.test(l) && !ok5.test(l)) failures.push(`brief.ts:${i + 1} reads an old-source condition or argument field: ${l.trim().slice(0, 160)}`);
  });
  const oos = src.split("\n").filter((l) => /\.outOfScope\b/.test(l));
  for (const l of oos) if (!/hasDossier\(c\.outOfScope\.summary, key\)/.test(l)) failures.push(`brief.ts reaches the full summary outside the out-of-scope call: ${l.trim().slice(0, 160)}`);
  // statids8: the names the Brief states are the cards' own - no read of the old sources for them. Allowed: comment
  // lines, the Map's moves (actOf / leverAbout quote the Map cell's wall - moves are out of this stage's scope), and
  // the moves' "today" line and hover tip (they name the Map's taker), and the fixed-situation fallback name.
  const bad8 = /\blegacyLift\b|\bawaySpecifics\b|legacyArgs\.away\b|\b(st|cs|st0)\.wall\b|\bst\.taker\b|\.lines\[0\]\.label|\b(v|r|good\.r|ex\.r)\.line\b(?!\()|\.routes\b|\$\{r\.rival\}|poss\(r\.rival\)|\(\{ concern: r\.concern,|sort\(\(a, b\) => kOf\(b\.stat\) - kOf\(a\.stat\)\)/;
  const ok8 = /^\s*(\/\/|\*|\/\*\*)|stop arguing against buyers who say "\$\{condLabel\(st\.wall\)\}"|leverAbout\(p\.lever, brand, st\.wall\)|^\s*return st\.wall$|today \$\{st\.taker\}|for \$\{st\.taker\}`|on \$\{st\.taker\}'s|cardLabel\(c, cellId, st\.taker\)|line: r\.line \}|k\.away\.filter\(\(g\) => g\.routes|destOf\(g\.routes, g\.answers \?\? 0\)|return g\.routes\[0\] \? /;
  src.split("\n").forEach((l, i) => {
    if (bad8.test(l) && !ok8.test(l)) failures.push(`brief.ts:${i + 1} reads an old source for a name the Brief states: ${l.trim().slice(0, 160)}`);
  });
}
const strictChecked: string[] = [];
const noFunnel: string[] = [];
const counts = { linked: 0, def: 0, one: 0, card: 0, table: 0, unlinked: 0, unlinkedHome: 0 };
const tables: string[] = [];
/** The tracker's own Brief alone (the rival's is the second subject). */
const own = { linked: 0, def: 0, one: 0, card: 0, table: 0, unlinked: 0, unlinkedHome: 0 };
const fallbacks = new Map<string, string[]>();
const homeless: string[] = [];
/** Stage 2 tallies per tracker: linked by stat id, linked by matching, fallback (answer card / table), unlinked. */
const per = new Map<string, { stat: number; matched: number; fallback: number; unlinked: number; statRead: number }>();
const matchedKinds = new Map<string, number>();
const nowStrings = new Map<string, string[]>();
const sentencesOf = (t: string) => t.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
const allStrings = (x: any, out: string[] = []): string[] => {
  if (typeof x === "string") out.push(x);
  else if (Array.isArray(x)) x.forEach((y) => allStrings(y, out));
  else if (x && typeof x === "object")
    for (const [k, v] of Object.entries(x)) {
      if (["links", "tip", "cell"].includes(k)) continue;
      // A paragraph's pins (anchors) are skipped; a SWOT quadrant's `cells` are its paragraphs (statids8: they were skipped too).
      if (k === "cells" && Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && "id" in v[0]) continue;
      allStrings(v, out);
    }
  return out;
};

for (const project of (await store.listProjects()).filter((p: any) => !p.archived_at)) {
  const run = (await store.listRuns(project.id))[0];
  const data = await loadViewData(run, project, { setupDecision: true, judge: true });
  // On a snapshot of live the run carries its live revision, so the saved condition groupings are read.
  if (data) data.revision = await (await import(process.cwd() + "/src/lib/engine/run_revision.ts")).cachedRunRevision(run.id);
  const first: any = await computeBrief(data, {});
  // The tracker's own Brief and its first rival's (the rival panels' links are checked too).
  const briefs: [string | undefined, any][] = [[undefined, first], ...(first.subjects?.[1] ? [[first.subjects[1], await computeBrief(data, { subject: first.subjects[1] })] as [string, any]] : [])];
  const { view: map } = await sharedAnalysisMap(data, {});
  const { view: summary, inputs } = await sharedBrandSummary(data, {});
  // Stage 3: the negative control (the strict guard throws on a funnel read) and the funnel universe.
  {
    const st = stripFunnel(summary);
    const throws = (f: () => unknown) => {
      try {
        f();
        return false;
      } catch (e: any) {
        return /BRIEF_STRICT_FUNNEL/.test(e?.message ?? "");
      }
    };
    if (!throws(() => (st.target as any).chosen.k) || !throws(() => (st.brands[1] as any)?.mentioned.k) || !throws(() => (st.summary as any).firmPickInCategory.k))
      failures.push(`${project.brand}: the strict funnel guard did not throw on a stripped field (the strict run proves nothing)`);
    // Stage 4: the verdict guard.
    const sv = stripVerdicts(inputs, summary);
    if (!throws(() => (st.summary as any).headToHead.length) || !throws(() => (st.summary as any).customersDoubt) || !throws(() => (sv.inputs as any).value) || !throws(() => (sv.inputs as any).doubt) || !throws(() => (sv.inputs as any).alternatives) || !throws(() => (sv.inputs as any).conditions) || !throws(() => (sv.inputs as any).away) || !throws(() => (sv.inputs as any).taught))
      failures.push(`${project.brand}: the strict verdict guard did not throw on a stripped field (the strict run proves nothing)`);
    else strictChecked.push(project.brand);
    const reg0 = buildStatRegistry(map);
    for (const b of summary.brands) {
      const t = b.key === summary.target.key;
      const has = t
        ? reg0.step("chooses:open:all", "named", "you") && reg0.line("chooses:open:all", "share", "you") && reg0.line("chooses:open:all", "picked", "you")
        : reg0.rivalStep(b.name, "named", "rival") && reg0.rivalStep(b.name, "open", "rival") && reg0.rivalStep(b.name, "picked", "rival");
      if (!has) noFunnel.push(`${project.brand}: ${b.name}`);
    }
  }
  const terms = [
    ...summary.brands.filter((b: any) => b.key !== summary.target.key).map((b: any) => b.name),
    ...(summary.reasonLift ?? []).map((l: any) => l.code),
    ...(inputs.taught ?? []).map((t: any) => t.code),
    ...data.intents.flatMap((i: any) => [i.situation, i.concern]).filter(Boolean),
    ...(map.rivalPanels ?? []).map((r: any) => r.name),
  ];
  const R = linkResolver(map, terms, [...(summary.reasonLift ?? []).map((l: any) => l.code), ...(inputs.taught ?? []).map((t: any) => t.code)], conditionTerms(map));
  const allCells = Object.keys(map.positions);
  const reg = buildStatRegistry(map);
  const tally = { stat: 0, matched: 0, fallback: 0, unlinked: 0, statRead: 0 };
  per.set(project.brand, tally);
  for (const [subj, brief] of briefs) nowStrings.set(`${project.brand}|${subj ? "rival" : "own"}`, allStrings(brief.memos));
  let wb: any = null;
  /** A table link: the entry exists on this run's Data page, and what its rows show (each buying situation its own row). */
  const tableRows = (entry: string): string[] | null => {
    wb ??= computeWorkbench(data, {});
    const e = LIB_BY_ID.get(entry);
    if (!e || !entryAvailable(e, wb)) return null;
    const res = resolveSettings(entrySettings(e), wb);
    if (!res) return null;
    const pv = computePivot(res, wb);
    const col = pv.cols[0];
    return pv.rows.map((r: any) => {
      const a = pv.cells.get(`${r.key}|${col.key}`);
      const x = a && a.n ? a.k / a.n : 0;
      return `${r.label} ${x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`}`;
    });
  };
  for (const [subj, brief] of briefs)
  for (const [frame, memo] of Object.entries(brief.memos) as any[]) {
    for (const sec of memo.sections) {
      const units: { text: string; links?: any[]; row?: string; label?: string }[] = [];
      const rooms = new Set(data.intents.map((i: any) => (i.situation ?? "").trim().toLowerCase()).filter(Boolean));
      const ctxOf = (p: any) => (p.lead && rooms.has(p.lead.replace(/[.]$/, "").trim().toLowerCase()) ? p.lead.replace(/[.]$/, "") : "");
      for (const p of sec.paras ?? []) units.push({ text: `${p.lead ?? ""} ${p.text}`, links: p.links, label: ctxOf(p) });
      for (const q of sec.quads ?? []) for (const col of q.cells) for (const p of col) units.push({ text: `${p.lead ?? ""} ${p.text}`, links: p.links, label: ctxOf(p) });
      for (const r of sec.rows ?? []) {
        if (r.kind === "note") units.push({ text: r.label, row: "scoreboard note" });
        else {
          units.push({ text: r.value, links: r.links, row: "scoreboard / stages row", label: r.label });
          for (const x of [r.avg, r.top]) if (x) units.push({ text: x, row: "scoreboard competitor column", label: r.label });
        }
      }
      for (const r of sec.table?.rows ?? []) units.push({ text: r.slice(1).join(" | "), row: "visibility table", label: r[0] });
      if (sec.viz) for (const it of sec.viz.items) units.push({ text: `${it.value ?? ""} ${it.bValue ?? ""}`, row: "chart label", label: `${it.label}${it.who ? ` ${it.who}` : ""}` });
      // As brief.ts linkMemo reads them: on a rival's Brief a unit that names no one is about the rival.
      if (subj) for (const u of units) if (u.row !== "chart label" && u.row !== "visibility table" && R.terms(u.text).length === 0) u.label = [u.label, subj].filter(Boolean).join(" ");
      for (const u of units) {
        const seen = new Map<string, number>();
        for (const m of u.text.matchAll(NUMBER_TOKEN)) {
          const token = m[0];
          const occ = seen.get(token) ?? 0;
          seen.set(token, occ + 1);
          const { local, sentence } = numberContext(R, u.text, m.index!, m.index! + token.length, u.label ?? "");
          const link = (u.links ?? []).find((l: any) => l.token === token && l.occurrence === occ);
          const kind = kindOf(sentence, u.row);
          const where = `${project.brand}${subj ? ` [rival ${subj}]` : ""} [${frame}/${sec.key}]`;
          const ownB = !subj;
          if (link?.stat) {
            // Stage 2: linked by its stat id - exactly the registry's stat, no matching.
            tally.stat++;
            counts.linked++;
            if (ownB) own.linked++;
            const st = reg.get(link.stat);
            const destOk = st && (st.dest.kind === "cell" ? link.dest.kind === "cell" && link.dest.id === st.dest.id : link.dest.kind === "rival" && link.dest.name === st.dest.name);
            if (!st) failures.push(`${where} ${token} links to stat ${link.stat}, not in the registry`);
            else if (!(st.value.match(NUMBER_TOKEN) ?? []).includes(token)) failures.push(`${where} ${token} links to ${link.stat} whose value is ${st.value}`);
            else if (!destOk || JSON.stringify(st.reveal ?? null) !== JSON.stringify(link.reveal ?? null)) failures.push(`${where} ${token} -> ${JSON.stringify(link.dest)} ${JSON.stringify(link.reveal ?? null)} is not where ${link.stat} is shown`);
            else if (st.at === "default") counts.def++;
            else counts.one++;
            if (st && ownB) {
              if (st.at === "default") own.def++;
              else own.one++;
            }
            continue;
          }
          if (link) {
            if (link.dest.kind === "card" || link.dest.kind === "table") tally.fallback++;
            else {
              tally.matched++;
              matchedKinds.set(kind, (matchedKinds.get(kind) ?? 0) + 1);
              if (process.env.SHOW_MATCHED && kind.includes(process.env.SHOW_MATCHED)) console.log(`MATCHED ${where} ${token} [${u.label ?? ""}] "${sentence.slice(0, 180)}"`);
            }
            counts.linked++;
            if (ownB) own.linked++;
            if (link.dest.kind === "table") {
              counts.table++;
              if (ownB) own.table++;
              const rows = tableRows(link.dest.entry);
              if (!rows) failures.push(`${where} ${token} -> table ${link.dest.entry} is not on this run's Data page`);
              else tables.push(`${where} ${token} in "${sentence.slice(0, 200)}" -> table "${LIB_BY_ID.get(link.dest.entry).label}": ${rows.join("; ")}${rows.some((r) => r.endsWith(` ${token}`)) ? "" : ` (the figure ${token} itself is not a row: the pivot has no "every other situation" row)`}`);
              continue;
            }
            if (link.dest.kind === "card") {
              counts.card++;
              if (ownB) own.card++;
              const list = fallbacks.get(kind) ?? [];
              list.push(`${where} ${token} in "${sentence.slice(0, 220)}"`);
              fallbacks.set(kind, list);
              continue;
            }
            const dest = link.dest.kind === "cell" ? { kind: "cell" as const, id: link.dest.id } : { kind: "rival" as const, id: link.dest.name };
            if (!R.shows(dest, token, local, sentence, link.reveal)) failures.push(`${where} ${token} -> ${dest.kind} ${dest.id}${link.reveal ? ` ${JSON.stringify(link.reveal)}` : ""} does not show it beside its subject: "${sentence.slice(0, 160)}"`);
            else if (link.reveal) {
              counts.one++;
              if (ownB) own.one++;
            } else {
              counts.def++;
              if (ownB) own.def++;
            }
          } else {
            tally.unlinked++;
            counts.unlinked++;
            if (ownB) own.unlinked++;
            const found = R.find(token, local, sentence, { cells: allCells, rivals: [] }, "anywhere");
            if (found) {
              counts.unlinkedHome++;
              if (ownB) own.unlinkedHome++;
            }
            else homeless.push(`${where} ${kind}: ${token} in "${sentence.slice(0, 200)}"`);
          }
        }
      }
    }
  }
}

// Stage 2: the figure log - figures in fields with no link (scoreboard competitor columns, tables, charts) read by id,
// every stat figure's value is its registry stat's, every migrated sentence prints only stat figures (or a figure
// with no card home, listed), and no figure without a card home goes unlisted.
const regs = new Map<string, any>();
const maps = new Map<string, any>();
const needsHome = new Map<string, string[]>();
const byField = new Map<string, any[]>();
for (const e of FIG_LOG as any[]) {
  const k = `${e.brand}|${e.subject ?? ""}|${e.frame}|${e.section}|${e.field}`;
  if (!byField.has(k)) byField.set(k, []);
  byField.get(k)!.push(e);
  if (e.noHome) {
    const xs = needsHome.get(e.noHome) ?? [];
    xs.push(`${e.brand}${e.subject ? ` [rival ${e.subject}]` : ""} [${e.frame}/${e.section} ${e.field}] ${e.token} in "${e.text.slice(0, 160)}"`);
    needsHome.set(e.noHome, xs);
  }
  if (e.stat && !/ (lead|text)$|row \d+ value$/.test(e.field)) per.get(e.brand)!.statRead++;
}
for (const project of (await store.listProjects()).filter((p: any) => !p.archived_at)) {
  const run = (await store.listRuns(project.id))[0];
  const data = await loadViewData(run, project, { setupDecision: true, judge: true });
  // On a snapshot of live the run carries its live revision, so the saved condition groupings are read.
  if (data) data.revision = await (await import(process.cwd() + "/src/lib/engine/run_revision.ts")).cachedRunRevision(run.id);
  const { view: map } = await sharedAnalysisMap(data, {});
  regs.set(project.brand, buildStatRegistry(map));
  maps.set(project.brand, map);
}
// statids8: every name the Brief stated in a card's role (NAME_LOG) is on that card, in that role - checked against the
// card's own object, not the Brief's reading of it.
const nameKinds = new Map<string, number>();
{
  const lc = (x: string) => x.trim().toLowerCase();
  const cellLabels = (map: any) => new Map<string, string>(map.bands.flatMap((b: any) => b.rows.flatMap((r: any) => r.cells.map((x: any) => [x.id, x.label]))));
  const onCard = (e: any): boolean => {
    const map = maps.get(e.brand);
    const p = map?.positions[e.cellId];
    const pp = p?.panel;
    let ok = false;
    switch (e.kind) {
      case "wall":
        ok = !!p?.lever && p?.notes?.wall === e.name;
        break;
      case "taker":
        ok = (pp?.competitors?.rows ?? []).find((r: any) => !r.you)?.name === e.name;
        break;
      case "away-row":
        ok = (pp?.conditions?.away ?? []).some((r: any) => r.text === e.name);
        break;
      case "away-to":
        ok = (pp?.conditions?.away ?? []).some((r: any) => (r.to ?? []).some((t: any) => t.name === e.name));
        break;
      case "value-product":
        ok = pp?.product === e.name && !pp?.byProduct;
        break;
      case "instead-rival":
        ok = pp?.details?.instead?.sections?.find((x: any) => x.title === "Where it points the buyer instead")?.rows?.[0]?.label === e.name;
        break;
      case "checklist":
        ok = (pp?.checklist ?? []).includes(e.name);
        break;
      case "checklist-against": {
        // The What to buy card's "when it picks another" column (the tracker), or the tracker's column on the rival's own card.
        const col = e.subject ? pp?.rivals?.find((r: any) => lc(r.name) === lc(e.subject))?.weighs?.columns?.[0] : pp?.weighsComp?.columns?.[1];
        const crit = Object.keys(map.positions).filter((id: string) => id.startsWith("chooses:criteria:"));
        const pooled = crit.includes("chooses:criteria:all") ? "chooses:criteria:all" : crit.length === 1 ? crit[0] : "";
        const list: string[] = map.positions[pooled]?.panel?.checklist ?? [];
        ok = (col?.rows ?? []).some((r: any) => lc(r.name) === lc(e.name)) && list.some((x: string) => lc(x) === lc(e.name));
        break;
      }
      case "cell-label":
        ok = cellLabels(map).get(e.cellId) === e.name;
        break;
    }
    return ok;
  };
  const negSeen = new Set<string>();
  for (const e of NAME_LOG as any[]) {
    const ok = onCard(e);
    nameKinds.set(e.kind, (nameKinds.get(e.kind) ?? 0) + 1);
    // Negative control, once per kind: the same entry with a name the card does not draw must fail the check.
    if (ok && !negSeen.has(e.kind)) {
      negSeen.add(e.kind);
      if (onCard({ ...e, name: `${e.name} (not on the card)` })) failures.push(`name check negative control: a made-up ${e.kind} name passed`);
    }
    if (!ok) failures.push(`${e.brand}${e.subject ? ` [rival ${e.subject}]` : ""}: the Brief names "${e.name}" (${e.kind}) from ${e.cellId}, which does not show it there`);
  }
}
for (const [k, es] of byField) {
  const reg = regs.get(es[0].brand);
  for (const e of es) if (e.stat && !((reg.get(e.stat)?.value ?? "").match(NUMBER_TOKEN) ?? []).includes(e.token)) failures.push(`${k}: ${e.token} read from ${e.stat} = ${reg.get(e.stat)?.value ?? "(no stat)"}`);
  // Positions of the logged figures in the field's text.
  const text = es[0].text as string;
  const seen = new Map<string, number>();
  const toks = [...text.matchAll(NUMBER_TOKEN)].map((m) => {
    const occ = seen.get(m[0]) ?? 0;
    seen.set(m[0], occ + 1);
    return { at: m.index!, token: m[0], fig: es.find((e) => e.token === m[0] && e.occurrence === occ) };
  });
  // A migrated sentence: one that prints a card figure. Every number in it must be a figure (stat, or no card home).
  let from = 0;
  for (const sn of sentencesOf(text)) {
    const at = text.indexOf(sn, from);
    from = at + sn.length;
    const inS = toks.filter((t) => t.at >= at && t.at < at + sn.length);
    if (!inS.some((t) => t.fig)) continue;
    for (const t of inS) if (!t.fig) failures.push(`${k}: ${t.token} printed without a stat id in a migrated sentence: "${sn.slice(0, 200)}"`);
  }
}
// No sentence of the before dump may be absent.
let beforeChecked = 0;
if (process.env.BRIEF_BEFORE) {
  const before = JSON.parse(fs.readFileSync(process.env.BRIEF_BEFORE, "utf8"));
  for (const [brand, v] of Object.entries(before) as any) {
    for (const which of ["own", "rival"]) {
      const memos = which === "own" ? v.own : v.rival?.memos;
      if (!memos) continue;
      const now = new Set((nowStrings.get(`${brand}|${which}`) ?? []).flatMap(sentencesOf));
      for (const sn of new Set(allStrings(memos).flatMap(sentencesOf))) {
        beforeChecked++;
        if (!now.has(sn)) failures.push(`${brand} [${which}]: sentence gone since the before dump: "${sn.slice(0, 200)}"`);
      }
    }
  }
}

console.log("STAGE 2 - per tracker: linked by stat id / linked by matching / fallback (answer card, table) / unlinked (of which read by stat id in a field with no link)");
const tot = { stat: 0, matched: 0, fallback: 0, unlinked: 0, statRead: 0 };
for (const [b, t] of per) {
  console.log(`  ${b}: ${t.stat} / ${t.matched} / ${t.fallback} / ${t.unlinked} (${t.statRead})`);
  for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += t[k];
}
console.log(`  TOTAL: ${tot.stat} / ${tot.matched} / ${tot.fallback} / ${tot.unlinked} (${tot.statRead})`);
console.log("STILL MATCHED, by kind (stage 3 scope):");
for (const [k, n] of [...matchedKinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
// The visibility chart's level line is the chart's own reference line - on no card by design (Tyler, 2026-11-17).
const byDesign = [...needsHome.keys()].filter((k) => /no card by design/.test(k));
const chartLines = byDesign.reduce((a, k) => a + needsHome.get(k)!.length, 0);
for (const k of byDesign) needsHome.delete(k);
console.log(`ON NO CARD BY DESIGN (the visibility chart's reference line): ${chartLines}`);
console.log(`NEEDS A CARD HOME (printed as before, no card shows it): ${[...needsHome.values()].reduce((a, x) => a + x.length, 0)}`);
if ([...needsHome.values()].some((x) => x.length)) failures.push(`${[...needsHome.values()].reduce((a, x) => a + x.length, 0)} figures are printed with no card home`);
for (const [k, xs] of needsHome) {
  console.log(`  ${k}: ${xs.length}`);
  for (const x of xs) console.log(`    - ${x}`);
}
if (process.env.BRIEF_BEFORE) console.log(`BEFORE DUMP: ${beforeChecked} sentences checked`);
console.log("");
console.log(`LINKED ${counts.linked}: on view where the link lands ${counts.def}, behind the one interaction the link opens ${counts.one}, a Data page table ${counts.table}, Brief answer card (no home) ${counts.card}`);
console.log(`UNLINKED ${counts.unlinked}: on some card or By rival card ${counts.unlinkedHome}, nowhere ${homeless.length}`);
console.log(`(tracker's own Brief only: linked ${own.linked} = ${own.def} on view + ${own.one} one interaction + ${own.table} table + ${own.card} answer card; unlinked ${own.unlinked}, ${own.unlinkedHome} on a card, ${own.unlinked - own.unlinkedHome} nowhere)`);
console.log(`\nLINKED TO A DATA PAGE TABLE: ${tables.length}`);
for (const x of tables) console.log(`  - ${x}`);
console.log("\nFALLBACKS TO THE BRIEF'S ANSWER CARD, by kind:");
for (const [k, xs] of [...fallbacks.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${k}: ${xs.length}`);
  for (const x of xs) console.log(`    - ${x}`);
}
console.log(`\nUNLINKED FIGURES ON NO CARD: ${homeless.length}`);
for (const x of homeless) console.log(`  - ${x}`);
// bf35: Map claims a move quoted that lost a clause (a number no card shows) or were dropped whole.
const trimmed = new Map<string, { brand: string; cellId: string; claim: string; kept: string }>();
for (const t of TRIMMED_CLAIMS) trimmed.set(`${t.brand}|${t.claim}`, t);
console.log(`\nMAP CLAIMS A MOVE QUOTES THAT LOST A CLAUSE: ${trimmed.size}`);
for (const t of trimmed.values()) console.log(`  - ${t.brand} [${t.cellId}]\n      was:  ${t.claim}\n      now:  ${t.kept || "(dropped whole)"}`);
console.log(`\nStage 3-5 (funnel, verdict, condition and argument decisions): every Brief above computed STRICT (a funnel, verdict, condition or argument read of the old source throws); guard negative controls passed on ${strictChecked.length} trackers.`);
console.log(`statids8 - names the Brief states, each checked on the card it is read from: ${[...nameKinds.entries()].map(([k, n]) => `${k} ${n}`).join(", ")}`);
console.log(`Summary brands with no funnel on any card (left out of every funnel decision): ${noFunnel.length ? noFunnel.join("; ") : "none"}`);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(failures.length ? `\n${failures.length} FAIL` : "\nALL PASS - every linked number opens a card that shows it beside its subject, or the Brief's own card");
process.exit(failures.length ? 1 : 0);
