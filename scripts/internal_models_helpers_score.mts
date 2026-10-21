/**
 * Scorer for internal_models_helpers.mts: reads internal_models/helpers/<arm>.json
 * for each arm and writes score.md + side_by_side.md next to them. No model calls.
 *   npx tsx scripts/internal_models_helpers_score.mts [armA armB]
 */
import fs from "node:fs";

const DIR = `${process.env.HOME}/Documents/procerno_eval/internal_models/helpers`;
const ARMS = process.argv.length > 3 ? process.argv.slice(2) : ["gpt-5-mini", "gpt-6-luna"];
const data: Record<string, any> = Object.fromEntries(ARMS.map((a) => [a, JSON.parse(fs.readFileSync(`${DIR}/${a}.json`, "utf8"))]));
const BRANDS = Object.keys(data[ARMS[0]].trackers).sort();

const pct = (n: number, d: number) => (d === 0 ? "-" : `${((100 * n) / d).toFixed(0)}%`);
const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const sec = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : "-");
const lines: string[] = [];
const P = (s = "") => lines.push(s);

P("# Instrument helper jobs: " + ARMS.join(" vs "));
P();
P(`Five October trackers (${BRANDS.join(", ")}), ${data[ARMS[0]].runs} runs per job per model, cache bypassed, inputs from projects.setup_decision. Generated rooms checked once each by the gate's room check (checkRooms, claude-sonnet-5 low, identical across arms; rivals = the tracker's full competitor list, no head-to-head picks - neither is stored on the project).`);
P();

// ---------- 1. reviewCells
P("## 1. reviewCells on the offered seeds");
P();
P("Answer key: a seed Tyler changed at the gate (how != offered, or decided text != offered) vs kept as offered. A flag on a kept seed is a likely false alarm; the prod gate only ever reviews edited prompts, so this measures the reviewer on engine text it would normally not see.");
P();
P("| model | changed cells | flag rate on changed (all runs) | kept cells | flag rate on kept (all runs) | kept flagged in 2+ of 3 | same verdict all 3 runs | flags by type |");
P("| --- | --- | --- | --- | --- | --- | --- | --- |");
const cellStab: Record<string, Record<string, { stable: number; n: number; kept: number; keptN: number; ch: number; chN: number }>> = {};
for (const a of ARMS) {
  let ch = 0, chN = 0, kept = 0, keptN = 0, keptMaj = 0, stable = 0, total = 0, nChanged = 0, nKept = 0;
  const types: Record<string, number> = {};
  cellStab[a] = {};
  for (const b of BRANDS) {
    const t = data[a].trackers[b];
    const runs = t.jobs.reviewCells as any[];
    const bs = { stable: 0, n: 0, kept: 0, keptN: 0, ch: 0, chN: 0 };
    t.cells.forEach((c: any, i: number) => {
      const f = runs.map((r) => (r.verdicts[i]?.flags?.length ?? 0) > 0);
      for (const r of runs) for (const fl of r.verdicts[i]?.flags ?? []) types[fl] = (types[fl] ?? 0) + 1;
      const nf = f.filter(Boolean).length;
      if (c.changed) { nChanged++; ch += nf; chN += f.length; bs.ch += nf; bs.chN += f.length; }
      else { nKept++; kept += nf; keptN += f.length; bs.kept += nf; bs.keptN += f.length; if (nf >= 2) keptMaj++; }
      total++; bs.n++;
      if (nf === 0 || nf === f.length) { stable++; bs.stable++; }
    });
    cellStab[a][b] = bs;
  }
  P(`| ${a} | ${nChanged} | ${pct(ch, chN)} (${ch}/${chN}) | ${nKept} | ${pct(kept, keptN)} (${kept}/${keptN}) | ${pct(keptMaj, nKept)} (${keptMaj}) | ${pct(stable, total)} | ${Object.entries(types).map(([k, v]) => `${k} ${v}`).join(", ")} |`);
}
P();
P("Per tracker (flag rate kept / changed; same verdict all runs):");
P();
P(`| tracker | ${ARMS.map((a) => `${a} kept / changed / stable`).join(" | ")} |`);
P(`| --- | ${ARMS.map(() => "---").join(" | ")} |`);
for (const b of BRANDS) {
  P(`| ${b} | ${ARMS.map((a) => { const s = cellStab[a][b]; return `${pct(s.kept, s.keptN)} / ${pct(s.ch, s.chN)} / ${pct(s.stable, s.n)}`; }).join(" | ")} |`);
}
P();
P("Changed cells, flags per run (each model):");
P();
for (const b of BRANDS) {
  const t0 = data[ARMS[0]].trackers[b];
  t0.cells.forEach((c: any, i: number) => {
    if (!c.changed) return;
    const per = ARMS.map((a) => `${a}: ${(data[a].trackers[b].jobs.reviewCells as any[]).map((r) => (r.verdicts[i]?.flags ?? []).join("+") || "ok").join(" / ")}`);
    P(`- ${b} ${c.stage}${c.situation ? ` (${c.situation})` : ""} [${c.how}]: ${per.join("; ")}`);
  });
}
P();

// ---------- 2. reviewJourneyFit
P("## 2. reviewJourneyFit on the offered base read");
P();
P("Answer key: Tyler kept the offered base read on all five trackers (decided = offered), and kept every recommended stage; his only stage delta is AmEx + business_case. Each run is already a majority of three samples inside the function.");
P();
const tylerDelta: Record<string, string[]> = {};
for (const b of BRANDS) {
  const s = data[ARMS[0]].trackers[b].stages;
  tylerDelta[b] = s.kept.filter((k: string) => !s.recommended.includes(k)).concat(s.recommended.filter((k: string) => !s.kept.includes(k)).map((k: string) => `-${k}`));
}
P(`| tracker | Tyler's stage delta | ${ARMS.map((a) => `${a} suggestions per run`).join(" | ")} |`);
P(`| --- | --- | ${ARMS.map(() => "---").join(" | ")} |`);
const jfSummary: Record<string, { empty: number; runs: number; stable: number; matchDelta: number }> = {};
for (const a of ARMS) jfSummary[a] = { empty: 0, runs: 0, stable: 0, matchDelta: 0 };
for (const b of BRANDS) {
  const cells = ARMS.map((a) => {
    const runs = data[a].trackers[b].jobs.reviewJourneyFit as any[];
    const sigs = runs.map((r) => (r.fit?.suggestions ?? []).map((s: any) => `${s.dimension}: ${s.current} -> ${s.suggested}${s.stagesIn?.length ? ` (+${s.stagesIn.map((x: any) => x.key).join(",")})` : ""}`).sort().join("; ") || "none");
    for (const r of runs) {
      jfSummary[a].runs++;
      const sg = r.fit?.suggestions ?? [];
      if (sg.length === 0) jfSummary[a].empty++;
      if (tylerDelta[b].length > 0 && sg.some((s: any) => (s.stagesIn ?? []).some((x: any) => tylerDelta[b].includes(x.key)))) jfSummary[a].matchDelta++;
    }
    if (new Set(sigs).size === 1) jfSummary[a].stable++;
    return sigs.join(" / ");
  });
  P(`| ${b} | ${tylerDelta[b].join(", ") || "none"} | ${cells.join(" | ")} |`);
}
P();
P(`| model | runs with no suggestion (= agrees with Tyler's kept base) | trackers with identical output all 3 runs | runs whose suggestion would bring in Tyler's added stage |`);
P("| --- | --- | --- | --- |");
for (const a of ARMS) P(`| ${a} | ${jfSummary[a].empty}/${jfSummary[a].runs} | ${jfSummary[a].stable}/${BRANDS.length} | ${jfSummary[a].matchDelta}/${data[a].runs} (AmEx) |`);
P();

// ---------- 3. reviewScenarios
P("## 3. reviewScenarios on the decided rooms");
P();
P("Every decided room was confirmed by Tyler, so any flag is a likely false alarm. Main call: all decided rooms as candidates (original = the offered room each came from - same label, else best word overlap among unmatched offered rooms). Gate-shaped call: only the edited / own rooms as candidates, the rest as `others` (what prod sends).");
P();
P("| model | rooms | flag rate, all-rooms call | as-offered rooms | edited/own rooms | same verdict all 3 runs | gate-shaped call flag rate | flags by type |");
P("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const a of ARMS) {
  let n = 0, f = 0, fo = 0, no = 0, fe = 0, ne = 0, stable = 0, rooms = 0, gf = 0, gn = 0;
  const types: Record<string, number> = {};
  for (const b of BRANDS) {
    const t = data[a].trackers[b];
    const runs = t.jobs.reviewScenarios as any[];
    t.decidedRooms.forEach((room: any, i: number) => {
      rooms++;
      const fl = runs.map((r) => (r.verdicts?.[i]?.flags?.length ?? 0) > 0);
      for (const r of runs) for (const x of r.verdicts?.[i]?.flags ?? []) types[x] = (types[x] ?? 0) + 1;
      const k = fl.filter(Boolean).length;
      n += fl.length; f += k;
      if (room.how === "offered") { no += fl.length; fo += k; } else { ne += fl.length; fe += k; }
      if (k === 0 || k === fl.length) stable++;
    });
    for (const r of t.jobs.reviewScenariosGate as any[]) for (const v of r.verdicts ?? []) { gn++; if (v.flags?.length) gf++; }
  }
  P(`| ${a} | ${rooms} | ${pct(f, n)} (${f}/${n}) | ${pct(fo, no)} | ${pct(fe, ne)} | ${pct(stable, rooms)} | ${pct(gf, gn)} (${gf}/${gn}) | ${Object.entries(types).map(([k, v]) => `${k} ${v}`).join(", ")} |`);
}
P();
P("Flagged rooms (run-by-run flags):");
P();
for (const b of BRANDS) {
  const t0 = data[ARMS[0]].trackers[b];
  t0.decidedRooms.forEach((room: any, i: number) => {
    const per = ARMS.map((a) => (data[a].trackers[b].jobs.reviewScenarios as any[]).map((r) => (r.verdicts?.[i]?.flags ?? []).join("+") || "ok").join(" / "));
    if (per.every((p) => /^ok( \/ ok)*$/.test(p))) return;
    P(`- ${b} "${room.label}" [${room.how}]: ${ARMS.map((a, k) => `${a} ${per[k]}`).join("; ")}`);
  });
}
P();

// ---------- 4. reviewScenarioFit
P("## 4. reviewScenarioFit on the offered rooms");
P();
P("Raw = the model's own advice before the function's mechanical brand drop and its reviewScenarios pre-check; final = what the gate would show.");
P();
P("| model | runs | off-portfolio flags | raw missing-room suggestions | passed pre-check as written | corrected by pre-check | dropped (pre-check or names brand) | trackers with identical final output all 3 runs |");
P("| --- | --- | --- | --- | --- | --- | --- | --- |");
const fitRows: string[] = [];
// humanize() rewrites dashes and spacing; that is not a pre-check correction.
const loose = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
for (const a of ARMS) {
  let runs = 0, off = 0, raw = 0, passed = 0, fixed = 0, dropped = 0, stable = 0;
  for (const b of BRANDS) {
    const rs = data[a].trackers[b].jobs.reviewScenarioFit as any[];
    const sigs: string[] = [];
    for (const r of rs) {
      runs++;
      off += r.fit?.offPortfolio?.length ?? 0;
      const rm = r.raw?.missing_core ?? null;
      const fm = r.fit?.missingCore ?? null;
      if (rm) {
        raw++;
        if (!fm) dropped++;
        else if (loose(fm.label) === loose(rm.label) && loose(fm.description) === loose(rm.description)) passed++;
        else fixed++;
      }
      sigs.push(JSON.stringify([(r.fit?.offPortfolio ?? []).map((x: any) => x.label).sort(), fm ? fm.label : null]));
      fitRows.push(`| ${b} | ${a} | ${(r.fit?.offPortfolio ?? []).map((x: any) => x.label).join(", ") || "-"} | ${rm ? `${rm.label}: ${rm.description}` : "-"} | ${fm ? `${fm.label}: ${fm.description}` : "-"} |`);
    }
    if (new Set(sigs).size === 1) stable++;
  }
  P(`| ${a} | ${runs} | ${off} | ${raw} | ${passed} | ${fixed} | ${dropped} | ${stable}/${BRANDS.length} |`);
}
P();
P("| tracker | model | off-portfolio | raw missing room | final missing room |");
P("| --- | --- | --- | --- | --- |");
for (const r of fitRows.sort()) P(r);
P();

// ---------- 5. generative jobs
P("## 5. suggestScenario / nearScenarios / rewordScenario");
P();
P("Pass = the gate's room check finds the room contested, with no tracked brand named, no pitch wording, and not a capability-only, platform-switch, no-choice or client-strength room (contestRoomSet's pass test). Inputs: suggest x3 per tracker with every room on the table excluded; near + reword once per decided room.");
P();
const gen = (a: string) => BRANDS.flatMap((b) => (data[a].trackers[b].generated as any[]).map((g) => ({ ...g, brand: b })));
const passes = (c: any) => c && c.contested && c.names.length === 0 && !c.pitch && !c.capability && !c.platformSwitch && !c.noChoice && !c.clientLead;
P("| model | job | calls | rooms returned | checked | pass | not contested | names brand | pitch | capability | platform switch | no choice | client lead |");
P("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const a of ARMS) {
  for (const job of ["suggestScenario", "nearScenarios", "rewordScenario"]) {
    const rs = gen(a).filter((g) => g.job === job);
    const chk = rs.filter((g) => g.check);
    const callsN = BRANDS.reduce((n, b) => n + (data[a].trackers[b].jobs[job] as any[]).length, 0);
    const cnt = (f: (c: any) => boolean) => chk.filter((g) => f(g.check)).length;
    P(`| ${a} | ${job} | ${callsN} | ${rs.length} | ${chk.length} | ${pct(cnt(passes), chk.length)} (${cnt(passes)}) | ${cnt((c) => !c.contested)} | ${cnt((c) => c.names.length > 0)} | ${cnt((c) => !!c.pitch)} | ${cnt((c) => c.capability)} | ${cnt((c) => c.platformSwitch)} | ${cnt((c) => c.noChoice)} | ${cnt((c) => c.clientLead)} |`);
  }
  const all = gen(a).filter((g) => g.check);
  P(`| ${a} | all | | ${gen(a).length} | ${all.length} | ${pct(all.filter((g) => passes(g.check)).length, all.length)} | | | | | | | |`);
}
P();
P("Rooms the room check returned no verdict for are left out of `checked` (gpt-5-mini 3 Jira rooms).");
P();
P("Pass rate per tracker (all generated rooms):");
P();
P(`| tracker | ${ARMS.join(" | ")} |`);
P(`| --- | ${ARMS.map(() => "---").join(" | ")} |`);
for (const b of BRANDS) P(`| ${b} | ${ARMS.map((a) => { const g = gen(a).filter((x) => x.brand === b && x.check); return `${pct(g.filter((x) => passes(x.check)).length, g.length)} (${g.filter((x) => passes(x.check)).length}/${g.length})`; }).join(" | ")} |`);
P();
P("Empty returns (null / short pool):");
P();
for (const a of ARMS) {
  const nullSug = BRANDS.reduce((n, b) => n + (data[a].trackers[b].jobs.suggestScenario as any[]).filter((r) => !r.room).length, 0);
  const nullRew = BRANDS.reduce((n, b) => n + (data[a].trackers[b].jobs.rewordScenario as any[]).filter((r) => !r.room).length, 0);
  const shortNear = BRANDS.reduce((n, b) => n + (data[a].trackers[b].jobs.nearScenarios as any[]).filter((r) => (r.rooms?.length ?? 0) < 3).length, 0);
  const sugDup = BRANDS.reduce((n, b) => { const ls = (data[a].trackers[b].jobs.suggestScenario as any[]).map((r) => r.room?.label?.toLowerCase()).filter(Boolean); return n + (ls.length - new Set(ls).size); }, 0);
  P(`- ${a}: suggest null ${nullSug}, suggest repeats a label across its 3 runs ${sugDup}, reword null ${nullRew}, near pool under 3 ${shortNear}`);
}
P();

// ---------- cost + latency
P("## Cost and latency");
P();
P("Cost from each arm's local ledger (cost_usd). The room check (claude-sonnet-5) is the scoring instrument, not the arm.");
P();
P("| model | helper-model cost | room-check cost | helper calls |");
P("| --- | --- | --- | --- |");
for (const a of ARMS) {
  const rows = data[a].costByModel as any[];
  const helper = rows.filter((r) => r.model === data[a].helperModel);
  P(`| ${a} | $${helper.reduce((s, r) => s + (r.cost ?? 0), 0).toFixed(3)} | $${rows.filter((r) => r.model !== data[a].helperModel).reduce((s, r) => s + (r.cost ?? 0), 0).toFixed(3)} | ${helper.reduce((s, r) => s + r.calls, 0)} |`);
}
P();
P("Median latency per OpenAI call, by job (calls made inside the job, so scenario fit includes its pre-check call):");
P();
const JOBS = ["reviewCells", "reviewJourneyFit", "reviewScenarios", "reviewScenarioFit", "suggestScenario", "nearScenarios", "rewordScenario"];
P(`| job | ${ARMS.map((a) => `${a} per call`).join(" | ")} | ${ARMS.map((a) => `${a} per job invocation`).join(" | ")} |`);
P(`| --- | ${ARMS.map(() => "---").join(" | ")} | ${ARMS.map(() => "---").join(" | ")} |`);
for (const j of JOBS) {
  const perCall = ARMS.map((a) => sec(median((data[a].calls as any[]).filter((c) => c.job === j && c.ok).map((c) => c.ms))));
  const perJob = ARMS.map((a) => sec(median(BRANDS.flatMap((b) => ((data[a].trackers[b].jobs[j] as any[]) ?? []).map((r) => r.ms)))));
  P(`| ${j} | ${perCall.join(" | ")} | ${perJob.join(" | ")} |`);
}
P();
P(`Errors logged: ${ARMS.map((a) => `${a} ${data[a].errors.length}`).join(", ")}; failed OpenAI calls: ${ARMS.map((a) => `${a} ${(data[a].calls as any[]).filter((c) => !c.ok).length}`).join(", ")}.`);
P();
fs.writeFileSync(`${DIR}/score.md`, lines.join("\n"));

// ---------- side by side
const sb: string[] = ["# Generated rooms side by side", "", "Per tracker: the three suggestScenario rooms, the near-variant pool of the first decided room, and the rewording of the first two decided rooms. Mark = the gate's room check: PASS, or the failing checks.", ""];
const mark = (c: any) => {
  if (!c) return "(unchecked)";
  if (passes(c)) return "PASS";
  const why = [!c.contested && `not contested (${c.inPool}/${c.pool})`, c.names.length && `names ${c.names.join(", ")}`, c.pitch && `pitch "${c.pitch}"`, c.capability && "capability", c.platformSwitch && "platform switch", c.noChoice && "no choice", c.clientLead && "client lead"].filter(Boolean);
  return `FAIL: ${why.join(", ")}`;
};
for (const b of BRANDS) {
  sb.push(`## ${b}`, "");
  const rooms = data[ARMS[0]].trackers[b].decidedRooms as any[];
  for (const a of ARMS) {
    const g = (data[a].trackers[b].generated as any[]);
    sb.push(`### ${a}`, "");
    sb.push("Suggest another:");
    for (const x of g.filter((x) => x.job === "suggestScenario")) sb.push(`- **${x.room.label}** - ${x.room.description} _[${mark(x.check)}]_`);
    sb.push("", `Near neighbors of "${rooms[0].label}" (${rooms[0].description}):`);
    for (const x of g.filter((x) => x.job === "nearScenarios" && x.of === rooms[0].label)) sb.push(`- **${x.room.label}** - ${x.room.description} _[${mark(x.check)}]_`);
    sb.push("", "Say it differently:");
    for (const r of rooms.slice(0, 2)) {
      const x = g.find((x) => x.job === "rewordScenario" && x.of === r.label);
      sb.push(`- "${r.label}" -> ${x ? `**${x.room.label}** - ${x.room.description} _[${mark(x.check)}]_` : "(no rewording returned)"}`);
    }
    sb.push("");
  }
}
fs.writeFileSync(`${DIR}/side_by_side.md`, sb.join("\n"));
console.log(lines.join("\n"));
