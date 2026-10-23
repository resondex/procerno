/** Scores setup_engine_round.mts arms (internal_models/setup_engine/).
 * Roster: no stored answer key (picks never persisted) - run-to-run
 * stability, cross-arm agreement vs the gpt-5 baseline, side-by-side for
 * Tyler. Read: reproduction of the tracker's DECIDED rooms (greedy one-to-one
 * word-overlap pairing), gate checkRooms results, draw-to-draw stability.
 * Worries: pool coverage of the DECIDED worry picks + stance agreement. */
import fs from "node:fs";

const DIR = `${process.env.HOME}/Documents/procerno_eval/internal_models/setup_engine`;
const ARMS = (process.env.ARMS ?? "gpt-5,gpt-5.6-sol,gpt-6-sol,gpt-6-luna").split(",");
const BASE = ARMS[0];
const data: Record<string, any> = {};
for (const a of ARMS) data[a] = JSON.parse(fs.readFileSync(`${DIR}/${a}.json`, "utf8"));
const brands = Object.keys(data[BASE].trackers);

const lines: string[] = [];
const P = (s = "") => { lines.push(s); console.log(s); };
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => w.length > 2));
const jac = (a: Set<string>, b: Set<string>) => {
  const i = [...a].filter((x) => b.has(x)).length;
  return i / Math.max(1, a.size + b.size - i);
};
const roomW = (r: { label: string; description: string }) => words(`${r.label} ${r.description}`);
/** Greedy one-to-one pairing: fraction of `keys` matched by `cands` at >= tau. */
function matchFrac(keys: { label: string; description: string }[], cands: { label: string; description: string }[], tau = 0.22): number {
  const left = cands.map(roomW);
  let hit = 0;
  for (const k of keys) {
    const kw = roomW(k);
    let bi = -1, bs = 0;
    left.forEach((c, i) => { const s = jac(kw, c); if (s > bs) { bs = s; bi = i; } });
    if (bi >= 0 && bs >= tau) { hit++; left.splice(bi, 1); }
  }
  return hit / Math.max(1, keys.length);
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const majority = <T>(xs: T[]): T => {
  const c = new Map<string, [number, T]>();
  for (const x of xs) { const k = JSON.stringify(x); const e = c.get(k) ?? [0, x]; e[0]++; c.set(k, e); }
  return [...c.values()].sort((a, b) => b[0] - a[0])[0][1];
};

P(`# Setup-engine round, steps 1-3 - ${new Date().toISOString().slice(0, 10)}`);
P();
P(`Arms: ${ARMS.join(", ")} (baseline ${BASE}). ${data[BASE].runs} runs per job per tracker; decided base journey passed in, so the read arm varies only the room read.`);
P();

// ---------- 1. roster
P("## 1. Roster (no stored key: stability + agreement with the baseline arm)");
P();
P("| arm | role same all runs | top-4 h2h set same all runs | clientParent stable | role = baseline (majority) | top-4 = baseline |");
P("| --- | --- | --- | --- | --- | --- |");
const top4 = (run: any): string[] =>
  (run.competitors ?? []).filter((c: any) => c.role === "same_seat")
    .sort((a: any, b: any) => (a.h2hRank ?? 1e9) - (b.h2hRank ?? 1e9)).slice(0, 4).map((c: any) => c.name).sort();
const baseMajority: Record<string, Record<string, string>> = {};
const baseTop4: Record<string, string> = {};
for (const b of brands) {
  const runs = data[BASE].trackers[b].roster.filter((r: any) => r.competitors);
  baseMajority[b] = {};
  for (const c of data[BASE].trackers[b].competitors) baseMajority[b][c] = majority(runs.map((r: any) => r.competitors.find((x: any) => x.name === c)?.role ?? "?"));
  baseTop4[b] = JSON.stringify(majority(runs.map(top4)));
}
for (const a of ARMS) {
  let roleStable = 0, roleN = 0, t4Stable = 0, parentStable = 0, roleAgree = 0, t4Agree = 0;
  for (const b of brands) {
    const t = data[a].trackers[b];
    const runs = t.roster.filter((r: any) => r.competitors);
    for (const c of t.competitors) {
      const roles = runs.map((r: any) => r.competitors.find((x: any) => x.name === c)?.role ?? "?");
      roleN++;
      if (new Set(roles).size === 1) roleStable++;
      if (majority(roles) === baseMajority[b][c]) roleAgree++;
    }
    if (new Set(runs.map((r: any) => JSON.stringify(top4(r)))).size === 1) t4Stable++;
    if (new Set(runs.map((r: any) => r.clientParent ?? "")).size === 1) parentStable++;
    if (JSON.stringify(majority(runs.map(top4))) === baseTop4[b]) t4Agree++;
  }
  P(`| ${a} | ${pct(roleStable / roleN)} (${roleStable}/${roleN}) | ${t4Stable}/${brands.length} | ${parentStable}/${brands.length} | ${pct(roleAgree / roleN)} | ${t4Agree}/${brands.length} |`);
}
P();

// ---------- 2. read
P("## 2. Market read (decided rooms as the key; checkRooms identical across arms)");
P();
P("| arm | decided rooms reproduced (mean) | draw-to-draw stability | contested rooms | check flags/run | journey overrides/run | rooms/draw |");
P("| --- | --- | --- | --- | --- | --- | --- |");
for (const a of ARMS) {
  const repro: number[] = [], stab: number[] = [], flags: number[] = [], contested: number[] = [], nrooms: number[] = [], ovr: number[] = [];
  for (const b of brands) {
    const t = data[a].trackers[b];
    const sdKey = data[BASE].trackers[b]; // decided rooms identical in every arm file? stored per arm - read from own file
    const decided = (dataDecided(a, b) ?? []) as any[];
    const runs = t.read.filter((r: any) => r.rooms);
    for (const r of runs) {
      repro.push(matchFrac(decided, r.rooms));
      nrooms.push(r.rooms.length);
      ovr.push(r.rooms.filter((x: any) => x.journey).length);
      const cs = r.checks ?? [];
      flags.push(cs.reduce((s: number, c: any) => s + (c.flags?.length ?? 0), 0));
      contested.push(cs.length ? cs.filter((c: any) => c.contested).length / cs.length : 0);
    }
    for (let i = 0; i < runs.length; i++)
      for (let j = i + 1; j < runs.length; j++)
        stab.push(matchFrac(runs[i].rooms, runs[j].rooms));
  }
  P(`| ${a} | ${pct(mean(repro))} | ${pct(mean(stab))} | ${pct(mean(contested))} | ${mean(flags).toFixed(1)} | ${mean(ovr).toFixed(1)} | ${mean(nrooms).toFixed(1)} |`);
}
P();

// decided rooms are not stored in the arm files; read them from setup_decision via the first arm's... store them inline:
function dataDecided(_a: string, b: string): any[] {
  // The runner scored worries against sd.rooms.decided but did not persist
  // them; recover from the worries context? decidedWorries only. Fall back
  // to a sidecar written by the scorer's caller.
  const side = `${DIR}/decided_rooms.json`;
  if (!fs.existsSync(side)) throw new Error("decided_rooms.json missing - write it first (see score header)");
  return JSON.parse(fs.readFileSync(side, "utf8"))[b];
}

// ---------- 3. worries
P("## 3. Worry planner (decided picks as the key)");
P();
P("| arm | decided worries covered by pool (mean) | stance agrees on covered | pool size | pool stability |");
P("| --- | --- | --- | --- | --- |");
const wordsOf = (s: string) => words(s);
for (const a of ARMS) {
  const cover: number[] = [], stance: number[] = [], sizes: number[] = [], stab: number[] = [];
  for (const b of brands) {
    const t = data[a].trackers[b];
    const decided = t.decidedWorries ?? [];
    const runs = t.worries.filter((r: any) => r.pool);
    for (const r of runs) {
      sizes.push(r.pool.length);
      let hit = 0, stanceOk = 0, stanceN = 0;
      for (const d of decided) {
        const dw = wordsOf(d.concern);
        const best = r.pool.map((w: any) => ({ w, s: jac(dw, wordsOf(w.worry)) })).sort((x: any, y: any) => y.s - x.s)[0];
        if (best && best.s >= 0.25) {
          hit++;
          const stages = best.w.recommend ?? (best.w.recommended ? [best.w.recommended] : []);
          stanceN++;
          if (stages.includes(d.stage)) stanceOk++;
        }
      }
      cover.push(hit / Math.max(1, decided.length));
      if (stanceN) stance.push(stanceOk / stanceN);
    }
    for (let i = 0; i < runs.length; i++)
      for (let j = i + 1; j < runs.length; j++) {
        const A = runs[i].pool.map((w: any) => w.worry), B = runs[j].pool.map((w: any) => w.worry);
        let hit = 0;
        const left = [...B];
        for (const x of A) {
          const xi = left.map((y) => jac(wordsOf(x), wordsOf(y)));
          const bi = xi.indexOf(Math.max(...xi, 0));
          if (bi >= 0 && xi[bi] >= 0.25) { hit++; left.splice(bi, 1); }
        }
        stab.push(hit / Math.max(1, A.length));
      }
  }
  P(`| ${a} | ${pct(mean(cover))} | ${pct(mean(stance))} | ${mean(sizes).toFixed(1)} | ${pct(mean(stab))} |`);
}
P();
for (const a of ARMS) if (data[a].errors?.length) P(`Errors (${a}): ${data[a].errors.length} console.error lines recorded`);

fs.writeFileSync(`${DIR}/score.md`, lines.join("\n") + "\n");
console.log(`\nwrote ${DIR}/score.md`);
