import { coderCompatClient } from "./providers";
import { tagCosts } from "../cost_log";
import { boundedNames } from "./mention_filter";

/**
 * Taxonomy discovery: open-code answers with NO code list - the labeler
 * names every attribute the answer argues FROM, freely. Measured 2026-09-22:
 * taxonomy-free coding reconstructs 99-100% of the curated argument space on
 * four brands and finds arguments any pre-supplied list suppresses; grok and
 * Opus converge on the same taxonomy, so discovery runs on the cheap model.
 *
 * Costs flow through the metered vendor client into the ledger like every
 * other engine call, tagged `discovery:open`.
 */

export interface DiscoveryAnswer {
  id: string;
  engine: string;
  prompt: string;
  text: string;
}

export interface DiscoveryCode {
  responseId: string;
  engine: string;
  reasons_open: string[];
}

// grok-4.3 by its real id: "grok-4-fast" was retired 2026-08-15 and every
// call under that alias has been served by grok-4.3 (reasoning on by
// default, ~900 reasoning tokens per answer billed as output - $0.0033 an
// answer measured 2026-10-11). The September "$5 census" was priced from a
// stale table; the true xAI bill was roughly ten times that.
const DISCOVERY_MODEL = process.env.DISCOVERY_MODEL ?? "gpt-6-luna";

/** Request parameters per discovery model (2026-10-11 tests, 300 answers x 2
 * runs each, `~/Documents/procerno_eval/discovery_tests_2026-10-11/`):
 * gpt-6-luna with reasoning OFF matches grok-4.3's argument space (48 of 50
 * top phrases both ways, 36 of 40 top brands) at the same density, with far
 * better self-consistency (count correlation 0.90 vs 0.62; brands Jaccard
 * 0.88 vs grok-luna 0.78) and ~15x lower cost ($0.0002 vs $0.0033 an
 * answer). The newer OpenAI models reject max_tokens and reason by default -
 * at a 600 cap they burned the whole budget thinking and returned nothing.
 * grok keeps the prod settings it was validated under. */
/** One discovery call is a short list; a call that has not answered in 45s
 * is wedged (rate-limit backoff, a hung socket) and the worker's own retry
 * handles it. The client default of 150s x 2 attempts let one wedged call
 * pin a worker for ten minutes against the route's five-minute limit: on
 * 2026-10-11 three bootstrap chunks were killed mid-pass with no hand-off
 * (last calls 04:22Z, nothing until a manual kick an hour later). */
const CALL_OPTS = { timeout: 45_000, maxRetries: 0 } as const;

/** Workers check the deadline only between tasks; a task in flight at the
 * deadline must not keep the chunk alive past the function limit. The pass
 * returns at the deadline (plus a short grace) with whatever landed - every
 * result is persisted as it arrives, so the next drive picks up the rest. */
async function untilDeadline<T>(work: Promise<T>, deadlineMs: number | undefined): Promise<void> {
  if (!deadlineMs) { await work; return; }
  const grace = 8_000;
  let timer: NodeJS.Timeout | undefined;
  const clock = new Promise<void>((r) => { timer = setTimeout(r, Math.max(0, deadlineMs + grace - Date.now())); });
  await Promise.race([work.then(() => undefined), clock]);
  if (timer) clearTimeout(timer);
}

function discoveryParams(model: string, cap: number): Record<string, unknown> {
  if (/^gpt-[5-9]/.test(model)) return { max_completion_tokens: Math.max(cap, 2000), reasoning_effort: "none" };
  return { temperature: 0, max_tokens: cap };
}

// Specificity sentence (2026-10-12, Tyler): measured on the same 300 answers,
// luna with the sentence produced 3,365 distinct phrases vs 1,999 without
// (grok-4.3: 2,723) and cut bare generic words from 4.7% to 1.6%; on a full
// Netflix census the catalog umbrella (86% "content variety") split back into
// originals, international, franchise, genre and movie codes, 28 codes at
// >= 15% vs 17. Self-agreement unchanged (0.45). No examples, per the rule.
const SYSTEM =
  "You code one AI assistant answer for a brand-visibility study. Be literal: " +
  "code only what the text says. This is a DISCOVERY pass with no fixed code " +
  "list: name each attribute the answer argues FROM (with a \"because\" " +
  "justifying a recommendation or warning) as a short lowercase noun phrase " +
  "(1-3 words), one per distinct attribute, brand-agnostic - code the " +
  "argument no matter which product it favors. Name the specific attribute " +
  "the answer argues from, never the general class it belongs to, and never a " +
  "single generic word when the answer says what the attribute is. " +
  "Topic-presence alone earns nothing. Reply with ONLY the JSON object: " +
  '{"reasons_open": ["<attribute phrases>, empty list when the answer argues from none"]}';

/**
 * Equal-per-engine stratified sample. coverage=1 returns everything (the
 * default - a full census costs ~$1/brand on the discovery model); below 1,
 * the target row count is split evenly across engines so no engine's answer
 * style dominates the discovered taxonomy, with any shortfall from thin
 * engines redistributed to the others. Deterministic for a given seed.
 */
export function sampleForDiscovery(
  answers: DiscoveryAnswer[],
  coverage: number,
  seed = 20260922
): DiscoveryAnswer[] {
  if (coverage >= 1) return answers;
  const target = Math.round(answers.length * coverage);
  const byEngine = new Map<string, DiscoveryAnswer[]>();
  for (const a of answers) {
    const list = byEngine.get(a.engine) ?? [];
    list.push(a);
    byEngine.set(a.engine, list);
  }
  // Mulberry32 - deterministic without pulling in a dependency.
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const engines = [...byEngine.keys()].sort();
  const pools = engines.map((e) =>
    [...byEngine.get(e)!].sort((a, b) => (a.id < b.id ? -1 : 1))
  );
  for (const pool of pools) {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }
  // Even quotas, then round-robin the remainder + any thin-engine shortfall.
  const picked: DiscoveryAnswer[] = [];
  const cursors = pools.map(() => 0);
  let need = target;
  while (need > 0 && pools.some((p, i) => cursors[i] < p.length)) {
    for (let i = 0; i < pools.length && need > 0; i++) {
      if (cursors[i] < pools[i].length) {
        picked.push(pools[i][cursors[i]++]);
        need--;
      }
    }
  }
  return picked;
}

/** Open-code the given answers on the discovery model. Returns one row per
 * answer that coded cleanly; failures are retried once then skipped and
 * reported via onProgress. */
export async function runOpenDiscovery(
  answers: DiscoveryAnswer[],
  opts: {
    coverage?: number;
    concurrency?: number;
    seed?: number;
    onProgress?: (done: number, failed: number, total: number) => void;
    /** Called as each answer codes - the bootstrap's persistence hook, so a
     * killed chunk resumes instead of re-spending. */
    onResult?: (row: DiscoveryCode) => Promise<void>;
    /** Workers stop pulling new answers past this time (epoch ms). */
    deadlineMs?: number;
  } = {}
): Promise<DiscoveryCode[]> {
  tagCosts({ purpose: "discovery:open" });
  const pool = sampleForDiscovery(answers, opts.coverage ?? 1, opts.seed);
  const c = coderCompatClient(DISCOVERY_MODEL);
  const out: DiscoveryCode[] = [];
  let cursor = 0;
  let failed = 0;
  const one = async (a: DiscoveryAnswer) => {
    const res = await c.chat.completions.create({
      model: DISCOVERY_MODEL,
      ...discoveryParams(DISCOVERY_MODEL, 600),
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Question: ${a.prompt}\n\nAnswer:\n${a.text}` },
      ],
    }, CALL_OPTS);
    const raw = (res.choices[0]?.message?.content ?? "").trim();
    const parsed = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim()) as {
      reasons_open?: string[];
    };
    return (parsed.reasons_open ?? []).filter((p) => typeof p === "string");
  };
  const worker = async () => {
    while (cursor < pool.length) {
      if (opts.deadlineMs && Date.now() >= opts.deadlineMs) return;
      const a = pool[cursor++];
      try {
        let codes: string[];
        try {
          codes = await one(a);
        } catch {
          await new Promise((r) => setTimeout(r, 2500));
          codes = await one(a);
        }
        const row = { responseId: a.id, engine: a.engine, reasons_open: codes };
        await opts.onResult?.(row);
        out.push(row);
      } catch {
        failed++;
      }
      if ((out.length + failed) % 250 === 0)
        opts.onProgress?.(out.length, failed, pool.length);
    }
  };
  await untilDeadline(
    Promise.all(Array.from({ length: opts.concurrency ?? 16 }, worker)),
    opts.deadlineMs
  );
  opts.onProgress?.(out.length, failed, pool.length);
  return out;
}

/** Brand-mention discovery: which brands/products each answer actually
 * names. Feeds the dictionary gate with observed reality - who appears in
 * this market's answers and how often - instead of only the setup-seeded
 * list. Same metering, purpose discovery:brands via cost context. */
// Unified with the prod coder's mentions instruction (providers.ts), so the
// bootstrap census and the steady-state coder emit the same name vocabulary
// and every downstream calibration (family layer, co-occurrence guard, 1%
// floor) transfers between phases.
const BRANDS_SYSTEM =
  "You extract brand mentions from one AI assistant answer for a " +
  "brand-visibility study. List every company, brand, product, or service " +
  "named, including ones named only as integrations or adjacent tools. " +
  "Completeness matters; relevance is decided later. ONLY proper-noun " +
  "names: a generic descriptor ('a self-hosted server', 'open-source " +
  "tools', 'a spreadsheet') is never a mention. A phrase naming several " +
  "brands is one entry PER brand. Name the PRODUCT, not its parts: a " +
  "feature, module, view, add-on, edition, or pricing tier of a product is " +
  "the product itself - one entry per distinct product, deduped to the " +
  "most complete form the answer uses. Reply with ONLY the JSON object: " +
  '{"brands": ["<names>"]}';

export interface BrandMentions {
  responseId: string;
  engine: string;
  brands: string[];
}

export async function runBrandDiscovery(
  answers: DiscoveryAnswer[],
  opts: {
    coverage?: number;
    concurrency?: number;
    seed?: number;
    onProgress?: (done: number, failed: number, total: number) => void;
    onResult?: (row: BrandMentions) => Promise<void>;
    deadlineMs?: number;
  } = {}
): Promise<BrandMentions[]> {
  const pool = sampleForDiscovery(answers, opts.coverage ?? 1, opts.seed);
  const c = coderCompatClient(DISCOVERY_MODEL);
  const out: BrandMentions[] = [];
  let cursor = 0;
  let failed = 0;
  const one = async (a: DiscoveryAnswer) => {
    const res = await c.chat.completions.create({
      model: DISCOVERY_MODEL,
      ...discoveryParams(DISCOVERY_MODEL, 500),
      messages: [
        { role: "system", content: BRANDS_SYSTEM },
        { role: "user", content: `Question: ${a.prompt}\n\nAnswer:\n${a.text}` },
      ],
    }, CALL_OPTS);
    const raw = (res.choices[0]?.message?.content ?? "").trim();
    const parsed = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim()) as {
      brands?: string[];
    };
    // Boundary validation: a detected name must actually appear in the
    // answer as a token-bounded match ("Marvel" inside "Marvelous" doesn't).
    return boundedNames(
      a.text,
      (parsed.brands ?? []).filter((b) => typeof b === "string" && b.trim())
    );
  };
  const worker = async () => {
    while (cursor < pool.length) {
      if (opts.deadlineMs && Date.now() >= opts.deadlineMs) return;
      const a = pool[cursor++];
      try {
        let brands: string[];
        try {
          brands = await one(a);
        } catch {
          await new Promise((r) => setTimeout(r, 2500));
          brands = await one(a);
        }
        const row = { responseId: a.id, engine: a.engine, brands };
        await opts.onResult?.(row);
        out.push(row);
      } catch {
        failed++;
      }
      if ((out.length + failed) % 250 === 0)
        opts.onProgress?.(out.length, failed, pool.length);
    }
  };
  await untilDeadline(
    Promise.all(Array.from({ length: opts.concurrency ?? 16 }, worker)),
    opts.deadlineMs
  );
  opts.onProgress?.(out.length, failed, pool.length);
  return out;
}
