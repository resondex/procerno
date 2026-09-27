/**
 * Test D - battery lint + repair (lintAndRepair, the real function). Per
 * tracker: 36 real unbranded prompts (seeded sample of the prod battery)
 * plus 10 planted defects written for this test (5 unanchored - no
 * category signal; 5 spec-sheet - chained requirements, exact budgets),
 * sent as 3 batteries of ~15 like the legacy generator's. The lint's
 * per-prompt issues are read from its own "battery lint: repairing" log
 * line; repairs from its return value.
 * Env: PROMPT_LINT_MODEL + ARM. Output internal_models/lint/<ARM>.json
 */
import fs from "node:fs";
import { ARM, RUNS, closeProd, errors, localUsage, outDir, prod, seeded, trackers, REPO } from "./internal_models_common.mts";

const { lintAndRepair } = await import(`${REPO}/src/lib/engine/suggest`);
const { PROMPT_LINT_MODEL } = await import(`${REPO}/src/lib/engine/models`);

const PLANTED: Record<string, { anchoring: string[]; spec_sheet: string[] }> = {
  jira: {
    anchoring: [
      "what's the best tool for keeping my team organized?",
      "we keep dropping the ball on handoffs, what should we use?",
      "need something to track all our work, any recs?",
      "what do most startups use to stay on top of things?",
      "our current setup is a mess, what would you switch to?",
    ],
    spec_sheet: [
      "Need project management software with sprint planning, Gantt charts, time tracking, SSO, audit logs, and custom workflows for 85 users at under $12 per seat, live by March 1.",
      "Project management platform required: kanban, roadmaps, dependency tracking, resource management, API access, SOC 2, budget exactly $18,000 per year.",
      "Requirements for PM software: agile boards, burndown charts, Git integration, SAML, custom fields, automation rules, 99.9% uptime SLA, 150 seats, rollout in 45 days.",
      "Looking for project management software supporting portfolios, OKRs, capacity planning, approvals, guest access, data residency in the EU, and a 12-month contract capped at $30,000.",
      "Project tracking tool must have: time tracking, invoicing, client portals, Gantt, workload views, mobile apps, 2FA, and cost no more than $9.50 per user for 60 users.",
    ],
  },
  "American Express": {
    anchoring: [
      "which one should I get if I travel a lot?",
      "what's the smartest pick for someone just starting out?",
      "my partner says ours is a rip-off, what would you switch to?",
      "what do people usually recommend for everyday spending?",
      "is it worth paying more for the premium version of these?",
    ],
    spec_sheet: [
      "Need a credit card with 5x points on travel, no foreign transaction fees, lounge access, a $300 travel credit, 0% APR for 15 months, and an annual fee under $395.",
      "Credit card requirements: 3% cash back on groceries, 2% on gas, 1% everything else, $200 signup bonus after $1,000 spend, no annual fee, credit limit of at least $12,000.",
      "Business credit card needed with employee cards, expense integrations, 60-day float, 1.5% flat rewards, no preset limit, and approval within 5 business days.",
      "Looking for a card offering 0% balance transfer for 21 months, a 3% transfer fee cap, cell phone insurance, purchase protection, and a minimum 720 credit score requirement.",
      "Card must have: hotel status, airline credits, 80,000 bonus points after $6,000 in 6 months, TSA PreCheck credit, and an annual fee of exactly $550.",
    ],
  },
  Netflix: {
    anchoring: [
      "which one should we keep if we're cutting back?",
      "what's everyone using these days?",
      "is the ad version actually worth it?",
      "what's best for a family with little kids?",
      "which has the best stuff right now?",
    ],
    spec_sheet: [
      "Need a streaming service with 4K HDR, Dolby Atmos, 4 simultaneous streams, offline downloads, no ads, live sports, and a monthly price under $17.99.",
      "Streaming requirements: kids profiles with PIN locks, at least 10,000 titles, same-day movie releases, 6 user profiles, and a total annual cost of exactly $199.",
      "Looking for a video streaming subscription supporting live news, cloud DVR with 100 hours, 3 concurrent streams, regional sports, and cancellation at any time for under $70/month.",
      "Streaming platform must offer: original series, anime catalog, spatial audio, 2 downloads per device on 5 devices, a student discount, and a 30-day free trial.",
      "Video service needed with ad-free plan, 1080p minimum, Chromecast and AirPlay, parental controls by rating, household sharing for 2 homes, and price locked for 24 months.",
    ],
  },
  "Google Pixel": {
    anchoring: [
      "which one should I upgrade to this year?",
      "my current one is dying, what should I get?",
      "what's the best one for taking pictures of my kids?",
      "is it worth paying for the pro version?",
      "which lasts the longest before you need a new one?",
    ],
    spec_sheet: [
      "Need a smartphone with a 6.7-inch 120Hz OLED, 5,000mAh battery, 45W charging, IP68, 7 years of updates, 256GB storage, and a price of exactly $799.",
      "Smartphone requirements: 50MP main camera with 5x optical zoom, 12GB RAM, eSIM, satellite SOS, wireless charging, under 200 grams, and under $900.",
      "Looking for an Android phone with an unlocked bootloader, stock Android, 3.5mm jack, microSD slot, 6.1-inch screen, 4 years of warranty, and a budget capped at $650.",
      "Phone must have: on-device AI features, 8K video, Wi-Fi 7, UWB, 144Hz display, 1TB storage option, and trade-in credit of at least $400.",
      "Need a smartphone supporting dual physical SIM, 5G on all US carriers, 65W wired charging, 2 days of battery life, IP69, and total cost of ownership under $1,100 over 3 years.",
    ],
  },
};

const repairing: { text: string; issues: string[] }[][] = [];
const origLog = console.log;
console.log = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("battery lint: repairing")) repairing.push(args[1] as { text: string; issues: string[] }[]);
  origLog(...args);
};

const out: Record<string, unknown> = { arm: ARM, model: PROMPT_LINT_MODEL, brands: {} };
for (const t of await trackers()) {
  const all = await prod`SELECT text, theme FROM prompts WHERE project_id=${t.id} AND theme <> 'branded' AND coalesce(retired, 0) = 0 ORDER BY id`;
  const real = seeded(all.map((r) => ({ text: r.text as string, theme: r.theme as string })), 20260926).slice(0, 36);
  const planted = [
    ...PLANTED[t.brand].anchoring.map((text) => ({ text, theme: "planted", plant: "anchoring" })),
    ...PLANTED[t.brand].spec_sheet.map((text) => ({ text, theme: "planted", plant: "spec_sheet" })),
  ];
  const pool = seeded([...real.map((r) => ({ ...r, plant: null as string | null })), ...planted], 7);
  const batteries = [pool.slice(0, 15), pool.slice(15, 30), pool.slice(30)];
  const runs: unknown[] = [];
  for (let i = 0; i < RUNS; i++) {
    const verdicts: Record<string, { issues: string[]; repaired: string | null }> = {};
    for (const b of batteries) {
      repairing.length = 0;
      const outPrompts = await lintAndRepair(b.map(({ text, theme }) => ({ text, theme })), t.category);
      const flagged = new Map((repairing[0] ?? []).map((x) => [x.text, x.issues]));
      b.forEach((p, j) => {
        const after = outPrompts[j]?.text ?? p.text;
        verdicts[p.text] = { issues: flagged.get(p.text) ?? [], repaired: after !== p.text ? after : null };
      });
    }
    runs.push(verdicts);
    console.log(`${ARM} ${t.brand} run ${i}: ${Object.values(verdicts).filter((v) => v.issues.length).length} flagged of ${pool.length}`);
  }
  (out.brands as Record<string, unknown>)[t.brand] = { category: t.category, prompts: pool, runs };
}
out.usage = await localUsage();
out.errors = errors;
fs.writeFileSync(`${outDir("lint")}/${ARM}.json`, JSON.stringify(out, null, 1));
await closeProd();
process.exit(0);
