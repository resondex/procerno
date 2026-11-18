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
 *   (f) voice - no first-person plural about the brand, no bracketed signed-points shorthand;
 *   (g) quadrants - a memo drawn as quadrants keeps its headings, in order, each from its own facts;
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
import { METHOD_BANNED, PLAIN_BANNED } from "./plain_words";

// bw2 (2026-11-06): fact lines carry anchor tags the writer places; guard (e).
// bw4 (2026-11-17): a quadrant memo's later sections stay after the quadrants (tags carry their side; the count and
// headings must match), each quadrant keeps one item per composed item with a lead, an item's tags and numbers
// from one composed item; a move keeps its object (prompt rule; the composed action now carries it).
// bw3 (2026-11-16, bf29): (f) voice - no first-person plural about the brand, no bracketed signed-points
// shorthand, both also prompt rules; (g) quadrants - a frame drawn as quadrants (SWOT) keeps its four
// headings in order, each written from its own facts only, and reassembles as the 2x2 cards.
export const BRIEF_WRITER_VERSION = "bw5"; // bw5: quadrant leads are specific to the item, never the sheet's generic label.
const CACHE_TTL_MS = 100 * 365 * 24 * 3600 * 1000; // forever in practice - the saved-tracker rule (2026-11-09): re-keyed by a version bump or a sheet change, never aged out
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
  /** The quadrant heading the fact sits under, when the memo is drawn as quadrants. */
  quad?: string;
  /** bw4: the quadrant item the fact belongs to ("<heading>#<n>"). */
  item?: string;
  /** bw4: in a quadrant memo, whether the fact's section comes before or after the quadrants. */
  side?: "before" | "after";
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
  const quadAt = memo.sections.findIndex((x) => x.quads?.length);
  memo.sections.forEach((s, si) => {
    const lines: string[] = [];
    const keep = isKeepSection(s);
    const side: SheetAnchor["side"] = quadAt < 0 || si === quadAt ? undefined : si < quadAt ? "before" : "after";
    // A keep section is reinserted composed, anchors intact - its lines carry no tags.
    const tagged = (line: string, cells: BriefAnchor[] | undefined, quad?: string, item?: string) => {
      if (keep || !cells?.length) return line;
      const tags: string[] = [];
      const ids = new Set<string>();
      for (const c of cells) {
        if (ids.has(c.id)) continue;
        ids.add(c.id);
        const token = anchorToken(anchors.length);
        anchors.push({ token, id: c.id, label: c.label, ...(quad ? { quad } : {}), ...(item ? { item } : {}), ...(side ? { side } : {}) });
        tags.push(token);
      }
      return `${line} ${tags.join(" ")}`;
    };
    if (s.heading) lines.push(`## ${s.heading}`);
    for (const p of s.paras ?? []) lines.push(tagged(paraLine(p), p.cells));
    for (const r of s.rows ?? []) lines.push(tagged(r.kind === "note" ? r.label : `${r.label}: ${r.value}${r.avg ? ` (average competitor: ${r.avg})` : ""}${r.top ? ` (most-picked competitor: ${r.top})` : ""}`, r.cell ? [r.cell] : undefined));
    if (s.table) {
      lines.push(s.table.headers.join(" | "));
      for (const r of s.table.rows) lines.push(r.join(" | "));
    }
    for (const q of s.quads ?? []) {
      for (let i = 0; i < 2; i++) {
        lines.push(`### ${q.headers[i]}`);
        // bw4: one "- " line per item, so the writer sees where each item starts and ends.
        q.cells[i].forEach((p, n) => lines.push(`- ${tagged(paraLine(p), p.cells, q.headers[i], `${q.headers[i]}#${n}`)}`));
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
      for (const t of [v.xLabel, v.yLabel, v.vlineLabel, v.diagLabel, v.hlineLabel, v.clusterNote, ...(v.legend ?? [])]) {
        if (t) lines.push(t);
      }
    }
    if (keep) {
      keeps.push(s.key);
      out.push(`[[keep:${s.key}]]\n(kept as drawn - its contents, for reference:)\n${lines.join("\n")}\n[[/keep]]`);
    } else if (lines.length) {
      out.push(lines.join("\n"));
    }
  });
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

export type Violation = { kind: "numbers" | "vocabulary" | "keeps" | "length" | "anchors" | "shape" | "voice" | "quadrants"; detail: string };

/** (f) First-person plural about the brand, outside quoted wording (a quoted buyer may say "we"). */
const FIRST_PLURAL = /\b(?:[Ww]e|[Oo]ur|[Oo]urs|[Oo]urselves|us|Us)\b/;
/** (f) The bracketed signed-points shorthand: a plus or minus figure in points inside parentheses. */
const SIGNED_POINTS = /\(\s*[+\-\u2212]\s*\d+(?:\.\d+)?\s*(?:points?|pts?)\b[^)]*\)/i;
const outsideQuotes = (t: string) => t.replace(/"[^"]*"|\u201c[^\u201d]*\u201d/g, " ");

/** The quadrant headings of a memo drawn as quadrants, in reading order (Strengths, Weaknesses, ...); [] otherwise. */
export function quadHeadings(memo: BriefMemo): string[] {
  const q = memo.sections.find((s) => s.quads?.length);
  return q ? q.quads!.flatMap((x) => [x.headers[0], x.headers[1]]) : [];
}
const sameHeading = (a: string | undefined, b: string) => !!a && a.trim().replace(/[.:]$/, "").toLowerCase() === b.trim().toLowerCase();

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

/** Every violation of guards (a)-(g), in that order. */
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
  // bf29: the retired customer vocabulary (the map harness's own list), outside quoted wording.
  // Everyday words on those lists ("reason", "cell", "decided", "lift", "routes") are left to the writer:
  // banning them rejected ordinary prose and sent the memo back to the composed version.
  const EVERYDAY = new Set(["reason", "cell", "decided", "lift", "routes", "travels with"]);
  for (const s of strings) for (const [name, re] of [...PLAIN_BANNED, ...METHOD_BANNED]) if (!EVERYDAY.has(name) && re.test(outsideQuotes(s))) hits.add(name);
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
  // (f) voice
  {
    const found = new Set<string>();
    for (const t of strings) {
      const o = outsideQuotes(t);
      if (FIRST_PLURAL.test(o)) found.add("first-person plural (we / our / us) - write about the brand by name in the third person");
      if (SIGNED_POINTS.test(t)) found.add("a signed points figure in parentheses - state the difference in words inside the sentence");
    }
    if (found.size) v.push({ kind: "voice", detail: [...found].join("; ") });
  }
  // (g) quadrants
  const quads = quadHeadings(memo);
  if (quads.length) {
    const parts: string[] = [];
    const written = reply.sections.filter((s): s is { heading?: string; paras: BriefPara[] } => !("keep" in s));
    const at = quads.map((h) => written.findIndex((s) => sameHeading(s.heading, h)));
    const counts = quads.map((h) => written.filter((s) => sameHeading(s.heading, h)).length);
    if (counts.some((n) => n !== 1)) parts.push(`the sections headed ${quads.join(", ")} must each appear exactly once`);
    else {
      if (at.some((x, i) => i > 0 && x !== at[i - 1] + 1)) parts.push(`the sections headed ${quads.join(", ")} must come in that order, one after another`);
      const comp = memo.sections.filter((s) => !isKeepSection(s));
      const cqi = comp.findIndex((s) => s.quads?.length);
      if (at[0] > cqi) parts.push("no section may come between the opening and the quadrant sections");
      // bw4: the sections after the quadrants (the moves) come after them, as many as composed, under their own headings.
      const after = comp.slice(cqi + 1);
      const wAfter = written.slice(at[at.length - 1] + 1);
      if (wAfter.length !== after.length)
        parts.push(after.length ? `after the quadrant sections there must be exactly ${after.length === 1 ? "one section" : `${after.length} sections`}${after[0].heading ? `, headed ${after.map((x) => x.heading).join(", ")}` : ""}` : "no section may follow the last quadrant section");
      else after.forEach((x, i) => {
        if (x.heading && !sameHeading(wAfter[i].heading, x.heading)) parts.push(`the section after the quadrants must be headed ${x.heading}`);
      });
      // Every fact stays on its side of the quadrants: a tag from a section after them never sits before them.
      written.forEach((sec, wi) => {
        const side = wi < at[0] ? "before" : wi > at[at.length - 1] ? "after" : "quad";
        for (const p of sec.paras)
          for (const t of p.text.match(ANCHOR_TOKEN) ?? []) {
            const a = sheet.anchors.find((y) => y.token === t);
            if (a?.side && a.side !== side) parts.push(`${t} belongs ${a.side === "after" ? "after" : "before"} the quadrant sections`);
          }
      });
      at.forEach((x, i) => {
        if (!written[x].paras.length) parts.push(`the ${quads[i]} section has no text`);
      });
      // Nothing moves between quadrants: each tag and each number stays under its own heading.
      const q = memo.sections.find((s) => s.quads?.length)!.quads!;
      const sheetNums = quads.map((_, i) => {
        const cell = q[Math.floor(i / 2)].cells[i % 2];
        return numberTokens(cell.map((p) => paraLine(p)).join(" "));
      });
      const moved = new Set<string>();
      at.forEach((x, i) => {
        for (const p of written[x].paras) {
          for (const t of p.text.match(ANCHOR_TOKEN) ?? []) {
            const a = sheet.anchors.find((y) => y.token === t);
            if (a?.quad && !sameHeading(quads[i], a.quad)) moved.add(`${t} belongs under ${a.quad}`);
          }
          for (const n of numberTokens(`${p.lead ?? ""} ${p.text}`)) if (!sheetNums[i].has(n)) moved.add(`${n} is not a ${quads[i]} fact`);
        }
      });
      if (moved.size) parts.push(`facts moved between quadrants: ${[...moved].slice(0, 6).join("; ")}`);
      // bw4: one written item per composed item - same count, a lead on each, an item's tags and numbers from one
      // composed item.
      at.forEach((x, i) => {
        const items = q[Math.floor(i / 2)].cells[i % 2];
        const wp = written[x].paras;
        if (wp.length !== items.length) parts.push(`the ${quads[i]} section must have ${items.length} separate item${items.length === 1 ? "" : "s"}, one per item in the sheet`);
        if (items.every((p) => p.lead) && wp.some((p) => !p.lead)) parts.push(`every ${quads[i]} item needs a short lead`);
        // bw5: a lead says what THIS item is about (the brand, rival, buyer or argument), never the sheet's generic label.
        const generic = new Set(items.map((p) => (p.lead ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim()).filter(Boolean));
        if (wp.some((p) => p.lead && generic.has(p.lead.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim())))
          parts.push(`a lead under ${quads[i]} repeats the sheet's label - write a lead that names what the item is about`);
        const itemNums = items.map((p) => numberTokens(paraLine(p)));
        wp.forEach((p, k) => {
          const own = new Set((p.text.match(ANCHOR_TOKEN) ?? []).map((t) => sheet.anchors.find((y) => y.token === t)?.item).filter(Boolean));
          if (own.size > 1) parts.push(`${quads[i]} item ${k + 1} joins facts from more than one item`);
          const nums = [...numberTokens(`${p.lead ?? ""} ${p.text}`)];
          if (nums.length && !itemNums.some((set) => nums.every((n) => set.has(n)))) parts.push(`${quads[i]} item ${k + 1} joins numbers from more than one item`);
        });
      });
    }
    if (parts.length) v.push({ kind: "quadrants", detail: parts.join("; ") });
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
  // (g) A quadrant memo: its quadrant sections fold back into the composed section's 2x2 shape.
  const quads = quadHeadings(memo);
  const quadSec = memo.sections.find((s) => s.quads?.length);
  const quadParas = new Map<string, BriefPara[]>();
  reply.sections.forEach((s, i) => {
    if ("keep" in s) {
      const orig = byKey.get(s.keep);
      if (orig) sections.push(orig);
      return;
    }
    const qh = quads.find((h) => sameHeading(s.heading, h));
    if (qh && quadSec) {
      if (!quadParas.size) sections.push({ key: quadSec.key, quads: [] });
      quadParas.set(qh, s.paras.map(paraOf));
      return;
    }
    sections.push({ key: `w${i}`, ...(s.heading ? { heading: stripAnchors(s.heading) } : {}), paras: s.paras.map(paraOf) });
  });
  if (quadSec && quadParas.size) {
    const target = sections.find((x) => x.key === quadSec.key && x.quads);
    if (target)
      target.quads = quadSec.quads!.map((q) => ({
        headers: q.headers,
        cells: [quadParas.get(q.headers[0]) ?? [], quadParas.get(q.headers[1]) ?? []] as [BriefPara[], BriefPara[]],
      }));
  }
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
  "- Write about the brand by its name, in the third person. Never write \"we\", \"our\", \"ours\" or \"us\" about the brand; the memo's reader is not its narrator.",
  "- Never put a signed points figure in parentheses after a fact. State a difference in words inside the sentence.",
  "- Use the plain customer words the sheet uses. Never use internal analysis vocabulary for a contest, a group of buyers, a source or a fixed situation, even where it seems to name the idea more briefly.",
  "- Never swap one measure's name for another's: named, recommended, picked and share of picks are different measures, and each number keeps the measure the sheet gives it.",
  "- A recommended action keeps its object: say who or what it is aimed at, as the sheet does. Never shorten an action to a bare verb phrase that drops the buyers, the product or the question it is about.",
  "- Keep the memo no longer than the fact sheet.",
  "- Fact lines may end in tags like [[ma]] [[mb]]. When your prose states that line's fact, put its tag at the end of the sentence that states it. Use every tag exactly once, never invent one, and never put one inside a heading or lead.",
  'Reply with ONE JSON object and nothing else: {"sections":[{"heading":"...","paras":[{"lead":"...","text":"..."}]} or {"keep":"<key>"}]}. "heading" and "lead" are optional; "lead" is a short bold opening for a paragraph.',
].join("\n");

export function writerUser(sheet: FactSheet, ctx: { brand: string; product: string; quads?: string[] }, steer?: string): string {
  let u =
    `The memo is about ${ctx.brand}; the AI is asked which ${ctx.product} to choose.\n` +
    (ctx.quads?.length
      ? `This memo is drawn as quadrants. Keep exactly ${ctx.quads.length} sections headed ${ctx.quads.join(", ")}, in that order and one after another, after any opening section; every section the sheet places after the quadrants stays after them, under its own heading. Write each quadrant from the facts listed under that heading only - move nothing from one quadrant to another. Each quadrant has one paragraph per "- " item in the sheet, in any order: a short "lead" and the item's own sentence or two, with that item's tags and numbers and no other item's. Write every lead fresh: it names the brand, rival, buyer or argument that item is about, in a few words, and never repeats the label the sheet gives the item.\n`
      : "") +
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
      text = await call(BRIEF_WRITER_SYSTEM, writerUser(sheet, { ...ctx, quads: quadHeadings(memo) }, steer));
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
  if (!model.startsWith("claude")) return { memo, written: false, reason: "unavailable" };
  const sheet = factSheet(memo);
  const key = writtenCacheKey(model, ctx, memo.frame, sheet.text);
  const { store } = await import("../store");
  try {
    const raw = await store.cacheGet(key, CACHE_TTL_MS);
    if (raw) return { memo: JSON.parse(raw) as BriefMemo, written: true };
  } catch {
    /* a cache miss or a bad entry - write it fresh */
  }
  // A saved memo is served with or without a key (a snapshot of live has none); only writing a new one needs it.
  if (!process.env.ANTHROPIC_API_KEY) return { memo, written: false, reason: "unavailable" };
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
 * tracker's brand, full engine panel), then each of the six frames (BRIEF_FRAMES)
 * cache-first. Rivals are never warmed - a rival memo is written only when a
 * reader asks for it. Frames left when the deadline passes count as skipped;
 * a frame is only started before the deadline, so one call may run past it.
 * No key, a non-Claude writer model or no codes source: an all-skipped
 * no-op that never touches the store. Never throws.
 */
/** The plans whose dashboards serve written briefs. MUST match auth.ts
 * PLAN_WRITTEN_BRIEFS (auth imports next/headers, so engine code and
 * scripts cannot read it; keep the two in sync). */
const WRITTEN_PLANS = new Set(["pro", "enterprise"]);

/**
 * Whether this tracker's readers are served written briefs - the owner's
 * plan (2026-11-09, Tyler: the automatic warms spend Opus only for client
 * trackers on a written tier). Staff-owned and ownerless trackers read
 * false: an admin's option-B click generates lazily, or hand-run
 * scripts/warm_written_briefs.mts, which does not consult this.
 */
export async function writtenBriefsEntitled(project: Project): Promise<boolean> {
  if (!project.user_id) return false;
  try {
    const { store } = await import("../store");
    // 2026-11-16 (Tyler): the tracker's own brand's written memos are warmed
    // for anyone who can read them - a written-tier owner, or a staff owner
    // (the admin toggle). Only an owner on a composed-only plan is skipped.
    if (WRITTEN_PLANS.has(await store.getPlan(project.user_id))) return true;
    return await store.isStaffUserId(project.user_id).catch(() => false);
  } catch {
    return false;
  }
}

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
      // One more try on a rejected or failed write: a model reply varies call to call, so a frame that
      // fails once usually passes the next time. The reason is logged so a skip is never silent.
      let r = await writeBrief(memo, ctx);
      if (!r.written && r.reason !== "unavailable" && Date.now() < deadlineMs) {
        console.warn(`written brief: ${project.brand} ${frame} not written (${r.reason ?? "unknown"}) - trying once more`);
        r = await writeBrief(memo, ctx);
      }
      if (r.written) out.written++;
      else {
        console.warn(`written brief: ${project.brand} ${frame} skipped (${r.reason ?? "unknown"})`);
        out.skipped++;
      }
    }
  } catch (err) {
    console.error("written brief warm failed:", err);
    out.skipped = BRIEF_FRAMES.length - out.written - out.cached;
  }
  return out;
}

/**
 * Fact layer step 5, part 2: a written memo's numbers link by FACT ID. The writer copies every number from the fact
 * sheet (guard (a)); each composed number carries its fact (BriefLink.fact) and the card location that draws it. A
 * written number takes the fact of the composed number with the same value whose own statement names the same subject:
 *  - by id: one fact prints that value in the composed memo and its statement shares a subject word (or two words) with
 *    the written sentence, or exactly one of several facts printing that value has a statement sharing its subject
 *    words (names in capitals, quoted phrases) with the written sentence;
 *  - by the old word overlap (fallback): several facts print that value and the subject words do not tell them apart -
 *    the one whose statement shares most words wins, as before;
 *  - not at all: no composed number prints that value in a statement sharing two words.
 * `tally` (optional) counts each case. Applied when a written memo is served, so cached memos need no rewrite.
 */
export function relinkWritten(written: BriefMemo, composed: BriefMemo, tally?: { byId: number; fallback: number; none: number }): BriefMemo {
  type L = NonNullable<BriefPara["links"]>[number];
  const units: { text: string; links: L[] }[] = [];
  for (const s of composed.sections) {
    const add = (p: BriefPara) => p.links?.length && units.push({ text: `${p.lead ?? ""} ${p.text}`, links: p.links });
    s.paras?.forEach(add);
    s.quads?.forEach((q) => q.cells.forEach((col) => col.forEach(add)));
    for (const r of s.rows ?? []) if (r.links?.length) units.push({ text: r.kind === "note" ? r.label : `${r.label} ${r.value}`, links: r.links });
  }
  const STOP = new Set(["the", "and", "that", "those", "this", "with", "when", "where", "which", "what", "from", "into", "for", "its", "it", "are", "was", "has", "have", "than", "then", "them", "they", "their", "there", "only", "more", "most", "about", "against", "while", "answers", "answer", "one", "does", "not", "but", "all", "any", "out", "who", "how", "time", "times", "ask", "asks", "buyers", "buyer"]);
  const NUM = /\d+(?:\.\d+)?%|[+-]\d+ (?:pts|points)/g;
  const words = (t: string) => new Set((t.toLowerCase().match(/[a-z][a-z'+.-]{2,}/g) ?? []).filter((w) => !STOP.has(w)));
  /** The subject words of a statement: names written with a capital (not opening the sentence) and quoted phrases. */
  const subjects = (t: string) => {
    const out = new Set<string>();
    for (const m of t.matchAll(/"([^"]+)"/g)) out.add(m[1].toLowerCase());
    for (const m of t.matchAll(/(?<=[a-z,;:-] )([A-Z][\w'&+.!-]*(?: [A-Z][\w'&+.!-]*)*)/g)) out.add(m[1].toLowerCase());
    return out;
  };
  const sentenceAt = (text: string, at: number, len: number) => {
    const sb = Math.max(text.lastIndexOf(". ", at) + 1, 0);
    const se = text.indexOf(". ", at + len);
    return text.slice(sb, se < 0 ? text.length : se);
  };
  const around = (text: string, at: number, len: number) => {
    const sent = sentenceAt(text, at, len);
    const sb = Math.max(text.lastIndexOf(". ", at) + 1, 0);
    const se = text.indexOf(". ", at + len);
    return { sentence: words(sent), near: words(text.slice(Math.max(sb, at - 70), Math.min(se < 0 ? text.length : se, at + len + 70))), subjects: subjects(sent) };
  };
  const shared = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;
  type Cand = { link: L; sentence: Set<string>; near: Set<string>; subjects: Set<string> };
  const byToken = new Map<string, Cand[]>();
  for (const u of units) {
    const seen = new Map<string, number>();
    for (const m of u.text.matchAll(NUM)) {
      const occ = seen.get(m[0]) ?? 0;
      seen.set(m[0], occ + 1);
      const link = u.links.find((l) => l.token === m[0] && (l.occurrence ?? 0) === occ);
      if (!link?.fact) continue;
      const xs = byToken.get(m[0]) ?? [];
      xs.push({ link, ...around(u.text, m.index!, m[0].length) });
      byToken.set(m[0], xs);
    }
  }
  const para = (p: BriefPara): BriefPara => {
    if (p.links) return p;
    const seen = new Map<string, number>();
    const links: L[] = [];
    const text = `${p.lead ?? ""} ${p.text}`;
    for (const m of text.matchAll(NUM)) {
      const token = m[0];
      const occurrence = seen.get(token) ?? 0;
      seen.set(token, occurrence + 1);
      const here = around(text, m.index!, token.length);
      const cands = byToken.get(token) ?? [];
      const facts = new Set(cands.map((c) => c.link.fact));
      let pick: Cand | null = null;
      let how: "byId" | "fallback" | "none" = "none";
      // The facts whose own statement names a subject the written sentence names.
      const subjOf = (c: Cand) => [...c.subjects].some((w) => [...here.subjects].some((h) => h === w || h.includes(w) || w.includes(h)));
      if (facts.size === 1) {
        // One fact prints this value; its statement must still be about what the written sentence is about.
        const c = cands.find((x) => subjOf(x) || shared(here.sentence, x.sentence) >= 2);
        if (c) {
          pick = c;
          how = "byId";
        }
      } else if (facts.size > 1) {
        const subj = cands.filter(subjOf);
        const subjFacts = new Set(subj.map((c) => c.link.fact));
        if (subjFacts.size === 1) {
          pick = subj[0];
          how = "byId";
        } else {
          let best: { c: Cand; score: number } | null = null;
          for (const c of subj.length ? subj : cands) {
            const sc = shared(here.sentence, c.sentence);
            if (sc < 2) continue;
            const score = sc + 2 * shared(here.near, c.near);
            if (!best || score > best.score) best = { c, score };
          }
          if (best) {
            pick = best.c;
            how = "fallback";
          }
        }
      }
      if (tally) tally[how]++;
      if (pick) links.push({ ...pick.link, token, occurrence });
    }
    return links.length ? { ...p, links } : p;
  };
  return {
    ...written,
    sections: written.sections.map((s) => ({
      ...s,
      ...(s.paras ? { paras: s.paras.map(para) } : {}),
      ...(s.quads ? { quads: s.quads.map((q) => ({ ...q, cells: [q.cells[0].map(para), q.cells[1].map(para)] as [BriefPara[], BriefPara[]] })) } : {}),
    })),
  };
}
