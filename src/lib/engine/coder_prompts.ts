/**
 * procerno_reason_coder prompt assembly (2026-10-29, Tyler's go: the
 * Fireworks provider integration). Given one collected answer, its cell
 * (intent) and the tracker's confirmed codebook, this builds the EXACT
 * request the coder was trained on - the labeling request's system text and
 * user message, byte for byte (finetune/ft_eval_v02.mts sends
 * system = params.system[0].text, user = params.messages[0].content).
 *
 * Nothing model-facing is authored here. Every sentence the model reads
 * lives in coder_contract.json, which scripts/derive_coder_contract.mts
 * derived mechanically from the frozen label/eval request bodies in
 * ~/Documents/procerno_eval (v2 requests + the drc3 choice/premium systems
 * + the Set C rules-bearing settled system) and from the builders' own
 * line constants. The derivation keeps a schema's template only when every
 * tracker that has rows on it yields the IDENTICAL template once its
 * per-tracker inputs are slotted out - so the template is a proven function
 * of exactly these inputs:
 *
 *   {{BRAND}}        the tracker's brand (projects.brand)
 *   {{CODES}}        "  - <code>: <scope sentence>" per confirmed code, in
 *                    reason_taxonomy order (scope sentences =
 *                    taxonomy_proposal.codes[].why)
 *   {{FLAGS}}        the includes_prices / includes_specs bullets carrying
 *                    the tracker's frozen flag vocabulary (v2 schemas only),
 *                    re-wrapped exactly as labeling/build_batch.mts does
 *   {{AW_AGNOSTIC}}  the awareness schemas' brand-bearing BRAND-AGNOSTIC
 *                    paragraph, re-wrapped (Python textwrap semantics) as
 *                    the builder does, because its line breaks move with
 *                    the brand's length
 *
 * scripts/coder_prompt_proof.mts rebuilds every stored request of the six
 * trackers from prod config + the vault and diffs them byte for byte.
 */
import contract from "./coder_contract.json";
import { schemaOf, type CodeSchema } from "./views";

export const CODER_CONTRACT_ID: string = contract.id;

/** The Set C stages share one rules-bearing settled system per tracker. */
const SETTLED_SCHEMAS = new Set<CodeSchema>(["business_case", "expansion", "ecosystem", "advocacy"]);

/** The fill-side constants (verbatim builder text) the slot functions need. */
export interface FillText {
  aw_agnostic: string;
  flag_block_v02: string;
  flag_price_eg_v02: string;
  flag_spec_eg_v02: string;
  flag_intro: string;
  specs_weigh: string;
}

// ---------------------------------------------------------------- pure fills

/** Whitespace-normalized text (the builder's wsNorm). */
export const wsNorm = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");

/** Python textwrap.fill(flat, width=78, initial_indent=first,
 * subsequent_indent="  ", break_long_words=False, break_on_hyphens=False),
 * as labeling/build_batch.mts pyFill reproduces it. Ends with "\n". */
export function pyFill(flat: string, first: string): string {
  const words = flat.split(/[\t\n\x0b\x0c\r ]+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (const w of words) {
    const width = 78 - (lines.length ? 2 : first.length);
    if (!cur.length) {
      cur = [w];
      len = w.length;
    } else if (len + 1 + w.length <= width) {
      cur.push(w);
      len += 1 + w.length;
    } else {
      lines.push(cur.join(" "));
      cur = [w];
      len = w.length;
    }
  }
  if (cur.length) lines.push(cur.join(" "));
  return lines.map((l, i) => (i ? "  " : first) + l).join("\n") + "\n";
}

/** labeling/build_batch.mts wrapBullet: width 78, two-space continuation,
 * a derived form's inner spaces held together so a form never splits. */
export function wrapBullet(flat: string, keep: string[]): string {
  const GLUE = "\u0000";
  for (const f of [...keep].sort((a, b) => b.length - a.length)) flat = flat.split(f).join(f.split(" ").join(GLUE));
  const words = flat.split(/[\t\n\x0b\x0c\r ]+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (const w of words) {
    const width = 78 - (lines.length ? 2 : 0);
    if (!cur.length) {
      cur = [w];
      len = w.length;
    } else if (len + 1 + w.length <= width) {
      cur.push(w);
      len += 1 + w.length;
    } else {
      lines.push(cur.join(" "));
      cur = [w];
      len = w.length;
    }
  }
  if (cur.length) lines.push(cur.join(" "));
  return lines.map((l, i) => (i ? "  " : "") + l).join("\n").split(GLUE).join(" ");
}

/** The two flag bullets with the tracker's own forms (build_batch.mts
 * flagBlockV2, including the delivered-only closing sentence). */
export function flagBlock(f: FillText, priceForms: string[], specForms: string[]): string {
  const at = f.flag_block_v02.indexOf("- includes_specs:");
  const pOld = wsNorm(f.flag_block_v02.slice(0, at));
  const sOld = wsNorm(f.flag_block_v02.slice(at));
  if (pOld.split(f.flag_price_eg_v02).length !== 2 || sOld.split(f.flag_spec_eg_v02).length !== 2) {
    throw new Error("coder contract: frozen flag example clauses not found");
  }
  const clause = (forms: string[]) => (forms.length ? `(${f.flag_intro}${forms.join(", ")})` : "");
  // an empty clause leaves "rate ." / "versions ." - the " ." -> "." closes the gap
  const pNew = pOld.split(f.flag_price_eg_v02).join(clause(priceForms)).split(" .").join(".");
  const sNew = sOld.split(f.flag_spec_eg_v02).join(clause(specForms)).split(" .").join(".") + " " + f.specs_weigh;
  return wrapBullet(pNew, priceForms) + "\n" + wrapBullet(sNew, specForms);
}

/** The code lines of the scope-aware codebook block. */
export function codeLines(codes: string[], defs: Record<string, string>): string {
  return codes.map((c) => `  - ${c}: ${defs[c]}`).join("\n");
}

/** The awareness schemas' re-wrapped BRAND-AGNOSTIC paragraph. */
export function awAgnosticText(f: FillText, brand: string): string {
  return pyFill(f.aw_agnostic.split("{{BRAND}}").join(brand), "  ");
}

// ---------------------------------------------------------------- inputs

/** Per-tracker frozen prompt inputs that prod config does not hold
 * (projects.coder_inputs, written by scripts/coder_inputs.mts from the
 * frozen labeling files - never re-derived per wave). */
export interface CoderInputs {
  version: 1;
  /** The tracker's derived price / spec example forms (labeling
   * v2_build/flag_vocab, "Per-category flag vocabulary ADOPTED"). */
  flag_vocab: { price: string[]; spec: string[] };
  /** Advocacy cells quote a criticism in their seed; no intent field
   * isolates it. intent id -> the criticism text as it sits inside the
   * design line's quotes. */
  critic: Record<string, string>;
  /** Optional scope sentences for confirmed codes the proposal does not
   * carry (a merge target); never overrides a proposal sentence. */
  defs?: Record<string, string>;
  /** Where the inputs came from (audit only). */
  provenance?: Record<string, unknown>;
}

export class CoderInputError extends Error {}

const FORM_OK = (s: unknown): s is string =>
  typeof s === "string" && !!s.trim() && s === s.trim() && !/[\n\r—()]/.test(s);

/** Parse and validate a stored coder_inputs JSON (throws CoderInputError). */
export function parseCoderInputs(raw: string | null | undefined): CoderInputs {
  if (!raw) throw new CoderInputError("no coder inputs are recorded for this tracker (projects.coder_inputs) - run scripts/coder_inputs.mts");
  let d: CoderInputs;
  try {
    d = JSON.parse(raw) as CoderInputs;
  } catch {
    throw new CoderInputError("projects.coder_inputs is not valid JSON");
  }
  if (d?.version !== 1) throw new CoderInputError(`projects.coder_inputs version ${JSON.stringify(d?.version)} is not 1`);
  const fv = d.flag_vocab;
  if (!fv || !Array.isArray(fv.price) || !Array.isArray(fv.spec) || ![...fv.price, ...fv.spec].every(FORM_OK)) {
    throw new CoderInputError("projects.coder_inputs.flag_vocab must carry price and spec lists of one-line forms (no parentheses, newlines or em dashes)");
  }
  if (!d.critic || typeof d.critic !== "object") throw new CoderInputError("projects.coder_inputs.critic must be an object (intent id -> criticism)");
  for (const [k, v] of Object.entries(d.critic)) {
    if (typeof v !== "string" || !v.trim() || v.includes('"') || /[\n\r]/.test(v)) {
      throw new CoderInputError(`projects.coder_inputs.critic[${k}] must be a one-line criticism with no double quotes`);
    }
  }
  return d;
}

/** The ratified codebook as the coder reads it: names from reason_taxonomy
 * (in stored order), each with its confirmed scope sentence from
 * taxonomy_proposal.codes[].why. Names match on the ratify step's slug
 * normalization (the proposal's "in-store testing" is ratified as
 * "in store testing"). A confirmed code with no sentence - a merge target -
 * takes coder_inputs.defs; still none = refused. Phrase moves are refused:
 * no trained contract carries a PHRASE ASSIGNMENTS block. */
export function resolveCodebook(
  project: { reason_taxonomy: string[]; taxonomy_proposal: string | null; taxonomy_decision: string | null; taxonomy_status: string },
  inputs: Pick<CoderInputs, "defs">
): { codes: string[]; defs: Record<string, string> } {
  if (project.taxonomy_status !== "ratified") throw new CoderInputError(`the codebook is not ratified (status ${project.taxonomy_status})`);
  const codes = project.reason_taxonomy;
  if (!codes.length) throw new CoderInputError("the ratified codebook is empty");
  if (new Set(codes).size !== codes.length) throw new CoderInputError("the ratified codebook carries a duplicate code");
  if (project.taxonomy_decision) {
    const dec = JSON.parse(project.taxonomy_decision) as { phrase_moves?: Record<string, string> };
    if (Object.keys(dec.phrase_moves ?? {}).length) {
      throw new CoderInputError("the codebook decision carries phrase moves; no trained coder contract carries a PHRASE ASSIGNMENTS block");
    }
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const why = new Map<string, string>();
  if (project.taxonomy_proposal) {
    const prop = JSON.parse(project.taxonomy_proposal) as { codes?: { code?: string; name?: string; why?: string }[] };
    for (const c of prop.codes ?? []) {
      const k = norm(c.code ?? c.name ?? "");
      if (k && c.why?.trim() && !why.has(k)) why.set(k, c.why.trim());
    }
  }
  const defs: Record<string, string> = {};
  const missing: string[] = [];
  for (const c of codes) {
    const s = why.get(norm(c)) ?? inputs.defs?.[c]?.trim();
    if (!s) missing.push(c);
    else if (/[\n\r]/.test(s)) throw new CoderInputError(`the scope sentence for "${c}" spans lines`);
    else defs[c] = s;
  }
  if (missing.length) throw new CoderInputError(`no confirmed scope sentence for ${missing.map((m) => `"${m}"`).join(", ")}`);
  return { codes, defs };
}

// ---------------------------------------------------------------- prompts

export interface CoderPromptContext {
  brand: string;
  codes: string[];
  defs: Record<string, string>;
  inputs: CoderInputs;
}

/** The cell fields the prompt reads. */
export interface CoderCell {
  id: string;
  stage: string;
  angle: string | null;
  concern: string | null;
}

const fills = contract.fills as FillText;
const systemCache = new WeakMap<CoderPromptContext, Map<string, string>>();

/** The system prompt for a schema (memoized per context object). */
export function systemFor(schema: CodeSchema, ctx: CoderPromptContext): string {
  let m = systemCache.get(ctx);
  if (!m) systemCache.set(ctx, (m = new Map()));
  const key = SETTLED_SCHEMAS.has(schema) ? "settled" : schema;
  const hit = m.get(key);
  if (hit) return hit;
  const tpl = (contract.systems as Record<string, string>)[key];
  if (!tpl) throw new CoderInputError(`no trained system prompt for schema ${schema}`);
  // Brand first (on the template only), then the per-tracker blocks, so a
  // brand inside a scope sentence or a flag form is never touched again.
  let s = tpl.split("{{BRAND}}").join(ctx.brand);
  s = s.split("{{AW_AGNOSTIC}}").join(awAgnosticText(fills, ctx.brand));
  s = s.split("{{FLAGS}}").join(flagBlock(fills, ctx.inputs.flag_vocab.price, ctx.inputs.flag_vocab.spec));
  s = s.split("{{CODES}}").join(codeLines(ctx.codes, ctx.defs));
  m.set(key, s);
  return s;
}

const lines = contract.lines as {
  criteria: string;
  defensive: string;
  stance: Record<string, string>;
  stance_line: string;
  worry: string;
  doubt: string;
  critic: string;
  settled: Record<string, string>;
  settled_line: string;
};
const fillBrand = (s: string, brand: string) => s.split("{{BRAND}}").join(brand);
const DOUBT_STAGES = new Set(["objections", "churn_triggers", "renewal"]);

/** The design line(s) the user message opens with, as the labeling builder
 * wrote them (build_batch.mts v2Line / settledPrefix, the stages file's
 * doubt line, fill_critic_lines.mts's critic line). "" = none. */
export function designPrefix(schema: CodeSchema, cell: CoderCell, ctx: CoderPromptContext): string {
  const B = ctx.brand;
  if (SETTLED_SCHEMAS.has(schema)) {
    const who = lines.settled[cell.stage];
    if (!who) throw new CoderInputError(`no settled design line for stage ${cell.stage}`);
    let critic = "";
    if (cell.stage === "advocacy") {
      const c = ctx.inputs.critic[cell.id];
      if (!c) throw new CoderInputError(`advocacy cell ${cell.id} has no recorded criticism (coder_inputs.critic)`);
      critic = fillBrand(lines.critic, B).split("{{CRITICISM}}").join(c) + "\n";
    }
    return fillBrand(lines.settled_line, B).split("{{STAGE}}").join(cell.stage).split("{{WHO}}").join(fillBrand(who, B)) + "\n" + critic + "\n";
  }
  const concern = cell.concern?.trim() ? cell.concern : null;
  const doubt = DOUBT_STAGES.has(cell.stage) && concern ? fillBrand(lines.doubt, B).split("{{CONCERN}}").join(concern) : null;
  let own: string | null = null;
  if (schema === "churn_renewal") {
    const who = lines.stance[cell.stage];
    if (!who) throw new CoderInputError(`no keep-or-leave stance line for stage ${cell.stage}`);
    const worry = concern ? lines.worry.split("{{CONCERN}}").join(concern.trim()) : "";
    own = lines.stance_line.split("{{STAGE}}").join(cell.stage).split("{{WHO}}").join(fillBrand(who, B)).split("{{WORRY}}").join(worry);
  } else if (schema === "alt_defensive") own = fillBrand(lines.defensive, B);
  else if (schema === "criteria") own = lines.criteria;
  if (doubt && schema !== "objections" && schema !== "churn_renewal") {
    throw new CoderInputError(`cell ${cell.id} (${cell.stage}) carries a doubt line but schema ${schema} asks no premise`);
  }
  const line = own ? own + (doubt ? `\n${doubt}` : "") : doubt ?? "";
  return line ? `${line}\n\n` : "";
}

export interface CoderRequest {
  schema: CodeSchema;
  system: string;
  user: string;
}

/** The trained request for one answer, or null when the cell has no
 * contract schema (a retired stage, or a prompt with no cell). */
export function buildCoderRequest(
  cell: CoderCell | null | undefined,
  promptText: string,
  answerText: string,
  ctx: CoderPromptContext
): CoderRequest | null {
  if (!cell) return null;
  const schema = schemaOf(cell.stage, cell.angle);
  if (!schema) return null;
  return {
    schema,
    system: systemFor(schema, ctx),
    user: designPrefix(schema, cell, ctx) + `Question: ${promptText}\n\nAnswer:\n${answerText}`,
  };
}
