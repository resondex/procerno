/** Scores scenario_review_round.mts arms (internal_models/helpers/mixed_round/).
 * Confirmed rooms: every flag is a likely false alarm (Tyler confirmed them
 * all). Planted probes: a genuine two-buyer fusion - the "mixed" flag is the
 * earned catch, and the sensitivity floor for any prompt change. */
import fs from "node:fs";

const DIR = `${process.env.HOME}/Documents/procerno_eval/internal_models/helpers/mixed_round`;
const ARMS = (process.env.ARMS ?? "mini,luna,luna-rule").split(",");
const data: Record<string, any> = {};
for (const a of ARMS) data[a] = JSON.parse(fs.readFileSync(`${DIR}/${a}.json`, "utf8"));

const lines: string[] = [];
const P = (s = "") => { lines.push(s); console.log(s); };

P(`# reviewScenarios "mixed" round - ${new Date().toISOString().slice(0, 10)}`);
P();
P(`Arms: ${ARMS.map((a) => `${a} = ${data[a].model}${data[a].mixedRule ? " + mixed rule" : ""}`).join("; ")}. Runs per call: ${data[ARMS[0]].runs}.`);
P();

P("## Confirmed rooms (every flag a likely false alarm)");
P();
P("| arm | rooms | flags (all runs) | mixed | phrasing | typo | rooms flagged 3/3 | same verdict all runs |");
P("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const a of ARMS) {
  let rooms = 0, verdicts = 0, flags = 0, stable = 0, all3 = 0;
  const byType: Record<string, number> = {};
  for (const t of Object.values<any>(data[a].trackers)) {
    const runs = t.confirmed.filter((r: any) => r.verdicts);
    const n = runs[0]?.verdicts.length ?? 0;
    rooms += n;
    for (let i = 0; i < n; i++) {
      const per = runs.map((r: any) => (r.verdicts[i].flags ?? []).join("+") || "ok");
      if (new Set(per).size === 1) stable++;
      if (per.every((x: string) => x !== "ok")) all3++;
      for (const r of runs) {
        verdicts++;
        const f = r.verdicts[i].flags ?? [];
        if (f.length) flags++;
        for (const x of f) byType[x] = (byType[x] ?? 0) + 1;
      }
    }
  }
  P(`| ${a} | ${rooms} | ${((100 * flags) / Math.max(1, verdicts)).toFixed(0)}% (${flags}/${verdicts}) | ${byType.mixed ?? 0} | ${byType.phrasing ?? 0} | ${byType.typo ?? 0} | ${all3} | ${((100 * stable) / Math.max(1, rooms)).toFixed(0)}% |`);
}
P();

P("Flagged confirmed rooms (run-by-run, per arm):");
P();
const brands = Object.keys(data[ARMS[0]].trackers);
for (const b of brands) {
  const n = data[ARMS[0]].trackers[b].decidedRooms.length;
  for (let i = 0; i < n; i++) {
    const per = ARMS.map((a) => {
      const runs = data[a].trackers[b].confirmed.filter((r: any) => r.verdicts);
      return runs.map((r: any) => (r.verdicts[i]?.flags ?? []).join("+") || "ok").join(" / ");
    });
    if (per.every((p) => !p.replace(/ok|\s|\//g, ""))) continue;
    const room = data[ARMS[0]].trackers[b].decidedRooms[i];
    P(`- ${b} "${room.label}" [${room.how}]: ${ARMS.map((a, k) => `${a}: ${per[k]}`).join("; ")}`);
  }
}
P();

P("## Planted two-buyer probes (the earned catch; 'mixed' is the right flag)");
P();
P("| arm | probe-verdicts | mixed flagged | any flag | probes caught (mixed) all runs |");
P("| --- | --- | --- | --- | --- |");
for (const a of ARMS) {
  let verdicts = 0, mixed = 0, any = 0, probes = 0, allRuns = 0;
  for (const t of Object.values<any>(data[a].trackers)) {
    const runs = t.planted.filter((r: any) => r.verdicts);
    const n = runs[0]?.verdicts.length ?? 0;
    probes += n;
    for (let i = 0; i < n; i++) {
      const caught = runs.map((r: any) => (r.verdicts[i].flags ?? []).includes("mixed"));
      if (caught.every(Boolean)) allRuns++;
      for (const r of runs) {
        verdicts++;
        const f = r.verdicts[i].flags ?? [];
        if (f.includes("mixed")) mixed++;
        if (f.length) any++;
      }
    }
  }
  P(`| ${a} | ${verdicts} | ${((100 * mixed) / Math.max(1, verdicts)).toFixed(0)}% (${mixed}) | ${((100 * any) / Math.max(1, verdicts)).toFixed(0)}% | ${allRuns}/${probes} |`);
}
P();
P("Probes missed (no mixed flag in at least one run):");
for (const b of brands) {
  const n = data[ARMS[0]].trackers[b].probes.length;
  for (let i = 0; i < n; i++) {
    const per = ARMS.map((a) => {
      const runs = data[a].trackers[b].confirmed && data[a].trackers[b].planted.filter((r: any) => r.verdicts);
      return runs.map((r: any) => ((r.verdicts[i]?.flags ?? []).includes("mixed") ? "mixed" : (r.verdicts[i]?.flags ?? []).join("+") || "MISS")).join(" / ");
    });
    if (!per.some((p) => p.includes("MISS"))) continue;
    const probe = data[ARMS[0]].trackers[b].probes[i];
    P(`- ${b} "${probe.label}" (${probe.fusedFrom.join(" + ")}): ${ARMS.map((a, k) => `${a}: ${per[k]}`).join("; ")}`);
  }
}
P();
for (const a of ARMS) if (data[a].errors?.length) P(`Errors (${a}): ${data[a].errors.length}`);

fs.writeFileSync(`${DIR}/score.md`, lines.join("\n") + "\n");
console.log(`\nwrote ${DIR}/score.md`);
