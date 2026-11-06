/**
 * The Brief pill's option B (2026-11-05, Tyler): a fact-guarded,
 * model-written version of a composed memo, served beside the template
 * version as a toggle.
 *
 * Arithmetic stays the only author of every number. The writer sees a FACT
 * SHEET - the composed memo's visible text only (never a `tip`: tips carry
 * counts, which are banned from customer surfaces) - and rewrites it as
 * flowing executive prose. Sections that carry structure (a chart, a table,
 * a scoreboard) are never rewritten: they appear in the sheet as
 * [[keep:<key>]] blocks, the writer places each token exactly once, and
 * reassembly drops the composed section back in, intact.
 *
 * Mechanical guards on every reply (pure functions below, unit-testable):
 *   (a) numbers - every numeric token in written text appears verbatim in
 *       the fact sheet;
 *   (b) vocabulary - no em dash, no method words, no x-of-y counts;
 *   (c) keeps - every keep is a structure section of the composed memo and
 *       each appears exactly once;
 *   (d) length - written text at most twice the fact sheet (anchor tags excluded);
 *   (e) anchors - each fact line's map anchor travels as a letter-only tag
 *       ([[ma]], [[mb]], ...; letters so guard (a) never sees them), and
 *       every tag appears exactly once in the written paragraphs' text.
 *       Reassembly strips the tags and sets each paragraph's `cells`.
 * A failing reply gets ONE steered retry naming the violations; still
 * failing (or no key / a thrown call) returns the composed memo with
 * written:false. Only written:true results cache - a later open retries.
 *
 * Store, ledger and client are imported lazily so the pure functions load
 * without a database or a key.
 */

import { createHash } from "node:crypto";
import { BRIEF_FRAMES, type BriefAnchor, type BriefMemo, type BriefPara, type BriefSection } from "./brief_types";
import type { Project, Run } from "../types";
import { BRIEF_WRITER_MODEL } from "./models";

// bw2 (2026-11-06): fact lines carry anchor tags the writer places; guard (e).
export const BRIEF_WRITER_VERSION = "bw2";
const CACHE_TTL_MS = 180 * 24 * 3600 * 1000;
/** Opus 5.x thinks before it writes and a whole-budget think returns empty
 * text (the recorded batch failure mode), so the budget leaves room for both. */
const MAX_TOKENS = 8000;

// ---------- the fact sheet ----------

/** A section the writer never rewrites: it renders a chart, a table or a scoreboard. */
export function isKeepSection(s: BriefSection): boolean {
  return !!(s.viz || s.table || s.rows);
}

function paraLine(p: BriefPara): string {
  return p.lead ? `${p.lead} ${p.text}` : p.text;
}

export interface SheetAnchor extends BriefAnchor {
  token: string;
}
export interface FactSheet {
  text: string;
  keeps: string[];
  anchors: SheetAnchor[];
}

/** The nth anchor tag: [[ma]] .. [[mz]], [[maa]], [[mab]], ... (letters only). */
export function anchorToken(n: number): string {
  let s = "";
  let x = n;
  do {
    s = String.fromCharCode(97 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return `[[m${s}]]`;
}
export const ANCHOR_TOKEN = /\[\[m[a-z]+\]\]/g;

/** Text with every anchor tag removed, spacing and punctuation tidied. */
export function stripAnchors(t: string): string {
  return t
    .replace(ANCHOR_TOKEN, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:!?)])/g, "$1")
    .trim();
}

/** The composed memo's visible text, in reading order. Tips are never read. */
export function factSheet(memo: BriefMemo): FactSheet {
  const out: string[] = [`TITLE: ${memo.title}`];
  const keeps: string[] = [];
  const anchors: SheetAnchor[] = [];
  for (const s of memo.sections) {
    const lines: string[] = [];
    const keep = isKeepSection(s);
    // A keep section is reinserted composed, anchors intact - its lines carry no tags.
    const tagged = (line: string, cells: BriefAnchor[] | undefined) => {
      if (keep || !cells?.length) return line;
      const tags: string[] = [];
      const ids = new Set<string>();
      for (const c of cells) {
        if (ids.has(c.id)) continue;
        ids.add(c.id);
        const token = anchorToken(anchors.length);
        anchors.push({ token, id: c.id, label: c.label });
        tags.push(token);
      }
      return `${line} ${tags.join(" ")}`;
    };
    if (s.heading) lines.push(`## ${s.heading}`);
    for (const p of s.paras ?? []) lines.push(tagged(paraLine(p), p.cells));
    for (const r of s.rows ?? []) lines.push(tagged(`${r.label}: ${r.value}`, r.cell ? [r.cell] : undefined));
    if (s.table) {
      lines.push(s.table.headers.join(" | "));
      for (const r of s.table.rows) lines.push(r.join(" | "));
    }
    for (const q of s.quads ?? []) {
      for (let i = 0; i < 2; i++) {
        lines.push(`### ${q.headers[i]}`);
        for (const p of q.cells[i]) lines.push(tagged(paraLine(p), p.cells));
      }
    }
    if (s.viz) {
      const v = s.viz;
      lines.push(`Chart: ${v.title}`);
      if (v.subtitle) lines.push(v.subtitle);
      for (const it of v.items) {
        const parts = [it.value ? `${it.label} = ${it.value}` : it.label];
        if (it.who && it.bValue) parts.push(`${it.who} = ${it.bValue}`);
        else if (it.bValue) parts.push(`second value = ${it.bValue}`);
        if (it.note) parts.push(it.note);
        lines.push(parts.join("; "));
      }
      for (const t of [v.xLabel, v.yLabel, v.vlineLabel, v.diagLabel, v.clusterNote, ...(v.legend ?? [])]) {
        if (t) lines.push(t);
      }
    }
    if (keep) {
      keeps.push(s.key);
      out.push(`[[keep:${s.key}]]\n(kept as drawn - its contents, for reference:)\n${lines.join("\n")}\n[[/keep]]`);
    } else if (lines.length) {
      out.push(lines.join("\n"));
    }
  }
  out.push(`FOOTER: ${memo.footer}`);
  return { text: out.join("\n\n"), keeps, anchors };
}

// ---------- the reply ----------

export type WrittenSection = { heading?: string; paras: BriefPara[] } | { keep: string };
export interface WrittenReply {
  sections: WrittenSection[];
}

const NUM = /\d[\d,.]*%?/g;
/** A number as a reader sees it: sentence punctuation after it is not part of it. */
const normNum = (t: string) => t.replace(/[.,]+$/, "");
export function numberTokens(s: string): Set<string> {
  return new Set((s.match(NUM) ?? []).map(normNum));
}

export const BANNED: { name: string; re: RegExp }[] = [
  { name: "em dash", re: /\u2014/ },
  { name: "open-choice", re: /open[- ]choice/i },
  { name: "share of decided", re: /share of decided/i },
  { name: "decided", re: /decided/i },
  { name: "firm pick", re: /firm pick/i },
  { name: "conditional", re: /conditional/i },
  { name: "premise", re: /premise/i },
  { name: "n=", re: /\bn\s*=/i },
  { name: "prompted", re: /prompted/i },
  { name: "instinct", re: /instinct/i },
  { name: "x of y count", re: /\d+ of \d+/ },
];

export type Violation = { kind: "numbers" | "vocabulary" | "keeps" | "length" | "anchors" | "shape"; detail: string };

function writtenStrings(reply: WrittenReply): string[] {
  const out: string[] = [];
  for (const s of reply.sections) {
    if ("keep" in s) continue;
    if (s.heading) out.push(s.heading);
    for (const p of s.paras) {
      if (p.lead) out.push(p.lead);
      out.push(p.text);
    }
  }
  return out;
}

/** Shape-check a parsed reply into WrittenReply, or null. */
export function parseReply(raw: unknown): WrittenReply | null {
  if (!raw || typeof raw !== "object") return null;
  const secs = (raw as { sections?: unknown }).sections;
  if (!Array.isArray(secs) || secs.length === 0) return null;
  const out: WrittenSection[] = [];
  for (const s of secs) {
    if (!s || typeof s !== "object") return null;
    const o = s as { keep?: unknown; heading?: unknown; paras?: unknown };
    if (typeof o.keep === "string") {
      out.push({ keep: o.keep });
      continue;
    }
    if (o.heading !== undefined && typeof o.heading !== "string") return null;
    if (!Array.isArray(o.paras)) return null;
    const paras: BriefPara[] = [];
    for (const p of o.paras) {
      if (!p || typeof p !== "object") return null;
      const pp = p as { lead?: unknown; text?: unknown };
      if (typeof pp.text !== "string" || !pp.text.trim()) continue;
      const lead = typeof pp.lead === "string" && pp.lead.trim() ? pp.lead.trim() : undefined;
      paras.push(lead ? { lead, text: pp.text.trim() } : { text: pp.text.trim() });
    }
    const heading = typeof o.heading === "string" && o.heading.trim() ? o.heading.trim() : undefined;
    if (!paras.length && !heading) continue;
    out.push(heading ? { heading, paras } : { paras });
  }
  return out.length ? { sections: out } : null;
}

/** Every violation of guards (a)-(e), in that order. */
export function checkReply(reply: WrittenReply, memo: BriefMemo, sheet: FactSheet): Violation[] {
  const v: Violation[] = [];
  const strings = writtenStrings(reply);
  const allowed = numberTokens(sheet.text);
  // (a) numbers
  const smuggled = new Set<string>();
  for (const s of strings) for (const t of numberTokens(s)) if (!allowed.has(t)) smuggled.add(t);
  if (smuggled.size) v.push({ kind: "numbers", detail: `numbers not in the fact sheet: ${[...smuggled].slice(0, 8).join(", ")}` });
  // (b) vocabulary
  const hits = new Set<string>();
  for (const s of strings) for (const b of BANNED) if (b.re.test(s)) hits.add(b.name);
  if (strings.some((s) => s.includes("[[keep"))) hits.add("keep token inside text");
  if (hits.size) v.push({ kind: "vocabulary", detail: `banned wording: ${[...hits].join(", ")}` });
  // (c) keeps
  const keepable = new Set(memo.sections.filter(isKeepSection).map((s) => s.key));
  const seen = new Map<string, number>();
  for (const s of reply.sections) if ("keep" in s) seen.set(s.keep, (seen.get(s.keep) ?? 0) + 1);
  const unknown = [...seen.keys()].filter((k) => !keepable.has(k));
  const dup = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  const missing = sheet.keeps.filter((k) => !seen.has(k));
  if (unknown.length || dup.length || missing.length) {
    const parts: string[] = [];
    if (missing.length) parts.push(`missing keep blocks: ${missing.join(", ")}`);
    if (dup.length) parts.push(`keep blocks used more than once: ${dup.join(", ")}`);
    if (unknown.length) parts.push(`keep keys that do not exist: ${unknown.join(", ")}`);
    v.push({ kind: "keeps", detail: parts.join("; ") });
  }
  // (d) length - tags never tip the budget
  const written = strings.reduce((n, s) => n + stripAnchors(s).length, 0);
  if (written > 2 * stripAnchors(sheet.text).length) v.push({ kind: "length", detail: "the written memo is more than twice as long as the fact sheet" });
  // (e) anchors - every sheet tag exactly once, in paragraph text only
  {
    const known = new Set(sheet.anchors.map((a) => a.token));
    const count = new Map<string, number>();
    const invented = new Set<string>();
    let misplaced = false;
    for (const s of reply.sections) {
      if ("keep" in s) continue;
      if (s.heading && s.heading.match(ANCHOR_TOKEN)) misplaced = true;
      for (const p of s.paras) {
        if (p.lead && p.lead.match(ANCHOR_TOKEN)) misplaced = true;
        for (const t of p.text.match(ANCHOR_TOKEN) ?? []) {
          if (!known.has(t)) invented.add(t);
          else count.set(t, (count.get(t) ?? 0) + 1);
        }
      }
    }
    const missing = sheet.anchors.map((a) => a.token).filter((t) => !count.has(t));
    const dup = [...count.entries()].filter(([, n]) => n > 1).map(([t]) => t);
    const parts: string[] = [];
    if (missing.length) parts.push(`tags never placed: ${missing.join(" ")}`);
    if (dup.length) parts.push(`tags used more than once: ${dup.join(" ")}`);
    if (invented.size) parts.push(`tags that are not in the fact sheet: ${[...invented].join(" ")}`);
    if (misplaced) parts.push("tags inside a heading or lead - put each at the end of the sentence that states its fact");
    if (parts.length) v.push({ kind: "anchors", detail: parts.join("; ") });
  }
  if (!strings.length) v.push({ kind: "shape", detail: "no written text" });
  return v;
}

/** The B memo: the writer's order, keep tokens replaced by the composed
 * sections, anchor tags stripped into each paragraph's `cells`. */
export function reassemble(reply: WrittenReply, memo: BriefMemo, anchors: SheetAnchor[] = []): BriefMemo {
  const byKey = new Map(memo.sections.map((s) => [s.key, s]));
  const byToken = new Map(anchors.map((a) => [a.token, a]));
  const paraOf = (p: BriefPara): BriefPara => {
    const cells: BriefAnchor[] = [];
    for (const t of p.text.match(ANCHOR_TOKEN) ?? []) {
      const a = byToken.get(t);
      if (a && !cells.some((c) => c.id === a.id)) cells.push({ id: a.id, label: a.label });
    }
    const out: BriefPara = { ...(p.lead ? { lead: stripAnchors(p.lead) } : {}), text: stripAnchors(p.text) };
    if (cells.length) out.cells = cells;
    return out;
  };
  const sections: BriefSection[] = [];
  reply.sections.forEach((s, i) => {
    if ("keep" in s) {
      const orig = byKey.get(s.keep);
      if (orig) sections.push(orig);
      return;
    }
    sections.push({ key: `w${i}`, ...(s.heading ? { heading: stripAnchors(s.heading) } : {}), paras: s.paras.map(paraOf) });
  });
  return { frame: memo.frame, title: memo.title, sections, footer: memo.footer };
}

/** The first complete top-level JSON object in a reply (string-aware brace
 * scan) - a mirror of instrument.ts's firstJsonObject, kept local so this
 * module does not load the instrument engine. */
export function firstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

// ---------- the prompt ----------

export const BRIEF_WRITER_SYSTEM = [
  "You write executive memos for a brand's leadership team from a measured fact sheet about how AI assistants answer buyers' questions.",
  "Rewrite the fact sheet into prose a Fortune-500 chief executive would read: synthesize, vary sentence shape, and carry one argument from start to finish. Group related facts, lead each section with what matters, and cut repetition. Short headings in sentence case are welcome.",
  "Hard rules:",
  "- Use ONLY facts, numbers and names present in the fact sheet. Never introduce a number, brand, product or claim the sheet does not contain, and never infer causes the sheet does not state.",
  "- Copy every number character-for-character exactly as the sheet writes it, percent sign included. Do not round, convert, add or subtract numbers, and do not write counts.",
  "- \"Share of picks\" means the brand's share when the AI commits to one product; keep that meaning wherever you use it.",
  "- The sheet marks charts and tables as [[keep:<key>]] blocks. Each keep key must appear exactly once in your reply, as its own entry, placed where that chart or table belongs in your argument. Never write the token inside text, and never restate a whole table in prose - refer to what it shows.",
  "- No research-method vocabulary: describe what the AI does and what buyers hear, never how it was measured.",
  "- Use \" - \" (space, hyphen, space) for a dash; never an em dash.",
  "- Keep the memo no longer than the fact sheet.",
  "- Fact lines may end in tags like [[ma]] [[mb]]. When your prose states that line's fact, put its tag at the end of the sentence that states it. Use every tag exactly once, never invent one, and never put one inside a heading or lead.",
  'Reply with ONE JSON object and nothing else: {"sections":[{"heading":"...","paras":[{"lead":"...","text":"..."}]} or {"keep":"<key>"}]}. "heading" and "lead" are optional; "lead" is a short bold opening for a paragraph.',
].join("\n");

export function writerUser(sheet: FactSheet, ctx: { brand: string; product: string }, steer?: string): string {
  let u =
    `The memo is about ${ctx.brand}; the AI is asked which ${ctx.product} to choose.\n` +
    `Keep blocks that must each appear exactly once: ${sheet.keeps.length ? sheet.keeps.join(", ") : "none"}.\n` +
    `Tags that must each appear exactly once: ${sheet.anchors.length ? sheet.anchors.map((a) => a.token).join(" ") : "none"}.\n\n` +
    `FACT SHEET\n\n${sheet.text}`;
  if (steer) u += `\n\nYour previous reply broke these rules - fix every one and reply again:\n${steer}`;
  return u;
}

// ---------- the call ----------

export interface WriteContext {
  runId: string;
  source: string;
  subjectKey: string;
  brand: string;
  product: string;
  projectId?: string;
}

export function writtenCacheKey(model: string, ctx: WriteContext, frame: string, sheetText: string): string {
  const sha = createHash("sha256").update(sheetText).digest("hex").slice(0, 12);
  return `brief_write:${BRIEF_WRITER_VERSION}:${model}:${ctx.runId}:${ctx.source}:${ctx.subjectKey}:${frame}:${sha}`;
}

/** One writing attempt's outcome. Exposed for the scratch tests. */
export function judgeText(text: string, memo: BriefMemo, sheet: FactSheet): { reply: WrittenReply | null; violations: Violation[] } {
  const j = firstJsonObject(text);
  let parsed: unknown = null;
  try {
    parsed = j ? JSON.parse(j) : null;
  } catch {
    parsed = null;
  }
  const reply = parseReply(parsed);
  if (!reply) return { reply: null, violations: [{ kind: "shape", detail: "the reply was not the requested JSON object" }] };
  return { reply, violations: checkReply(reply, memo, sheet) };
}

type Caller = (system: string, user: string) => Promise<string>;

/** The guarded writing loop with the model call injected (tests pass a stub). */
export async function writeWith(
  memo: BriefMemo,
  ctx: { brand: string; product: string },
  call: Caller
): Promise<{ memo: BriefMemo; written: boolean; reason?: string }> {
  const sheet = factSheet(memo);
  let steer: string | undefined;
  let first: Violation | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      text = await call(BRIEF_WRITER_SYSTEM, writerUser(sheet, ctx, steer));
    } catch {
      return { memo, written: false, reason: "unavailable" };
    }
    const { reply, violations } = judgeText(text, memo, sheet);
    if (reply && !violations.length) return { memo: reassemble(reply, memo, sheet.anchors), written: true };
    first = violations[0];
    steer = violations.map((x) => `- ${x.detail}`).join("\n");
  }
  return { memo, written: false, reason: first?.kind ?? "shape" };
}

export async function writeBrief(memo: BriefMemo, ctx: WriteContext): Promise<{ memo: BriefMemo; written: boolean; reason?: string }> {
  const model = BRIEF_WRITER_MODEL;
  if (!process.env.ANTHROPIC_API_KEY || !model.startsWith("claude")) return { memo, written: false, reason: "unavailable" };
  const sheet = factSheet(memo);
  const key = writtenCacheKey(model, ctx, memo.frame, sheet.text);
  const { store } = await import("../store");
  try {
    const raw = await store.cacheGet(key, CACHE_TTL_MS);
    if (raw) return { memo: JSON.parse(raw) as BriefMemo, written: true };
  } catch {
    /* a cache miss or a bad entry - write it fresh */
  }
  const { withCostContext, logCost } = await import("../cost_log");
  const { anthropicClient } = await import("./providers");
  const { fromAnthropicUsage } = await import("./usage");
  const call: Caller = async (system, user) => {
    const a = await anthropicClient();
    // Streamed then assembled (the consolidate.ts lesson: a non-streaming
    // call sends no bytes until the reply is ready). The metering wrapper
    // covers messages.create only, so usage is ledgered here.
    const stream = a.messages.stream(
      {
        model,
        max_tokens: MAX_TOKENS,
        // Opus 5.x rejects sampling params; effort is the knob.
        output_config: { effort: "medium" },
        system,
        messages: [{ role: "user", content: user }],
      } as never,
      { timeout: 240_000 }
    );
    const res = await stream.finalMessage();
    logCost({ model, usage: fromAnthropicUsage((res as { usage?: unknown }).usage) });
    return (res as { content: { type: string; text?: string }[] }).content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
  };
  const result = await withCostContext(
    { purpose: "views:brief_write", runId: ctx.runId, ...(ctx.projectId ? { projectId: ctx.projectId } : {}), rnd: false },
    () => writeWith(memo, { brand: ctx.brand, product: ctx.product }, call)
  );
  if (result.written) {
    await store
      .cacheSet(key, JSON.stringify(result.memo), { brand: ctx.brand, ...(ctx.projectId ? { projectId: ctx.projectId } : {}) })
      .catch(() => {});
  }
  return result;
}

/**
 * The client brand's written memos, written ahead of the first open: the
 * brief payload through the route's own cached path (default subject = the
 * tracker's brand, full engine panel), then each of the seven frames
 * cache-first. Rivals are never warmed - a rival memo is written only when a
 * reader asks for it. Frames left when the deadline passes count as skipped;
 * a frame is only started before the deadline, so one call may run past it.
 * No key, a non-Claude writer model or no codes source: an all-skipped
 * no-op that never touches the store. Never throws.
 */
export async function prewarmWrittenBriefs(
  run: Run,
  project: Project,
  deadlineMs: number
): Promise<{ written: number; cached: number; skipped: number }> {
  const out = { written: 0, cached: 0, skipped: 0 };
  const model = BRIEF_WRITER_MODEL;
  if (!process.env.ANTHROPIC_API_KEY || !model.startsWith("claude")) return { ...out, skipped: BRIEF_FRAMES.length };
  try {
    const { store } = await import("../store");
    const source = await store.getCodesSource(project.id);
    if (!source) return { ...out, skipped: BRIEF_FRAMES.length };
    const { computeBriefCached } = await import("./brief");
    const { matchKey } = await import("../brand_key");
    const { productNoun } = await import("./summary_insights");
    const view = await computeBriefCached(run, project);
    if (!view) return { ...out, skipped: BRIEF_FRAMES.length };
    const ctx: WriteContext = {
      runId: run.id,
      source,
      subjectKey: matchKey(view.subject),
      brand: view.subject,
      product: productNoun(project.category),
      projectId: project.id,
    };
    for (const frame of BRIEF_FRAMES) {
      const memo = view.memos[frame];
      if (!memo || Date.now() >= deadlineMs) {
        out.skipped++;
        continue;
      }
      const key = writtenCacheKey(model, ctx, frame, factSheet(memo).text);
      const hit = await store.cacheGet(key, CACHE_TTL_MS).catch(() => null);
      if (hit) {
        out.cached++;
        continue;
      }
      const r = await writeBrief(memo, ctx);
      if (r.written) out.written++;
      else out.skipped++;
    }
  } catch (err) {
    console.error("written brief warm failed:", err);
    out.skipped = BRIEF_FRAMES.length - out.written - out.cached;
  }
  return out;
}
