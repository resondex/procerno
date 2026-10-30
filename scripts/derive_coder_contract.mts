/**
 * Derive src/lib/engine/coder_contract.json - the frozen model-facing text of
 * procerno_reason_coder's trained prompts - mechanically from the stored
 * label / eval request bodies and the builders that wrote them. Offline,
 * read-only on ~/Documents/procerno_eval and the repo; zero spend.
 *
 *   npx tsx scripts/derive_coder_contract.mts [--check]
 *
 * SYSTEMS. For each of the six trackers whose rows the coder was trained or
 * evaluated on (five in v0.4/v0.5's mix + Sephora's ratified-book requests),
 * the one system text per schema exactly as the model reads it:
 *   - v2 schemas: labeling/v2_build/training/<t>_v2_all.jsonl, with the drc3
 *     recode system on choice + premium (labeling/v04_dr/recode, as
 *     finetune/ft_eval_v02.mts foldDrc3 swaps it in);
 *   - Set C: the tracker's ONE rules-bearing settled system
 *     (labeling/v04_dr/setc_recode/requests_<t>_drs.jsonl);
 *   - Sephora: finetune/warm_sephora/requests_sephora_ratified.jsonl (the
 *     confirmed 40-code book), schema per the arm's manifest.
 * The tracker's inputs are slotted out of each - the code lines, the flag
 * bullets, the awareness BRAND-AGNOSTIC paragraph (each rebuilt with the
 * app's own fill functions from the tracker's frozen inputs and required to
 * occur exactly once), then the brand - and the schema's template is kept
 * ONLY if every tracker with rows on it gives the identical template. Any
 * disagreement is a build failure: it would mean the trained prompt is not
 * a function of the inputs the app supplies.
 *
 * LINES. The user-message design lines are lifted from the builders'
 * source (build_batch.mts constants + its stance / settled formats, the
 * repo's build_stages_file.mts doubt line, g3/fill_critic_lines.mts's
 * critic line), each source pattern asserted present verbatim.
 *
 * --check: derive and compare with the committed JSON; exit 1 on any
 * difference (the file is never rewritten).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { codeLines, flagBlock, awAgnosticText, type FillText } from "../src/lib/engine/coder_prompts";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EV = `${process.env.HOME}/Documents/procerno_eval`;
const OUT = path.join(REPO, "src/lib/engine/coder_contract.json");
const CHECK = process.argv.includes("--check");

const fail = (msg: string): never => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};
const jl = (p: string) => fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const count = (s: string, sub: string) => s.split(sub).length - 1;

// ------------------------------------------------------------- line constants
const BB = `${EV}/labeling/build_batch.mts`;
const bb = fs.readFileSync(BB, "utf8");
/** A backtick literal `const NAME = \`...\`;` with ${B} as the only interpolation. */
function tick(name: string): string {
  const m = bb.match(new RegExp(`\\nconst ${name} = \`([^\`]*)\`;\\n`));
  if (!m) return fail(`build_batch.mts: const ${name} not found as one backtick literal`);
  const body = m[1];
  if (body.includes("\\")) fail(`${name}: contains a backslash escape`);
  if (body.replaceAll("${B}", "").includes("${")) fail(`${name}: interpolates something other than \${B}`);
  return body.replaceAll("${B}", "{{BRAND}}");
}
/** A double-quoted `const NAME = "...";`. */
function quoted(name: string): string {
  const m = bb.match(new RegExp(`\\nconst ${name} = ("(?:[^"\\\\]|\\\\.)*");\\n`));
  if (!m) return fail(`build_batch.mts: const ${name} not found as one string literal`);
  return JSON.parse(m[1]) as string;
}
/** Entries of a `const NAME: Record<string, string> = { k: \`..\` | "..", };` */
function record(name: string): Record<string, string> {
  const m = bb.match(new RegExp(`\\nconst ${name}: Record<string, string> = \\{\\n([\\s\\S]*?)\\n\\};\\n`));
  if (!m) return fail(`build_batch.mts: const ${name} record not found`);
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const e = line.match(/^ {2}([a-z_]+): (`[^`]*`|"[^"]*"),$/);
    if (!e) fail(`${name}: unexpected entry line ${JSON.stringify(line)}`);
    const raw = e![2];
    const v = raw.startsWith("`") ? raw.slice(1, -1) : (JSON.parse(raw) as string);
    if (v.includes("\\") || v.replaceAll("${B}", "").includes("${")) fail(`${name}.${e![1]}: unexpected escape or interpolation`);
    // "{BRAND}" first: the ${B} replacement's output would match it again.
    out[e![1]] = v.replaceAll("{BRAND}", "{{BRAND}}").replaceAll("${B}", "{{BRAND}}");
  }
  return out;
}
function mustContain(src: string, file: string, literal: string) {
  if (!src.includes(literal)) fail(`${file}: expected source text not found: ${literal}`);
}
mustContain(bb, "build_batch.mts", "return `Question design (keep or leave, ${d.stage}): ${who}.${worry}`;");
mustContain(bb, "build_batch.mts", "const worry = d.concern?.trim() ? ` Worry: \"${d.concern.trim()}\"` : \"\";");
mustContain(bb, "build_batch.mts", "return `Question design (settled customer, ${d.stage}): ${who}.\\n` + (d.line ? `${d.line}\\n` : \"\") + \"\\n\";");
mustContain(bb, "build_batch.mts", "return own ? own + (doubt ? `\\n${doubt}` : \"\") : doubt ?? \"\";");
mustContain(bb, "build_batch.mts", "`Question: ${prompts[r.prompt_id] ?? \"\"}\\n\\nAnswer:\\n${r.text}`");
const STAGES = path.join(REPO, "scripts/build_stages_file.mts");
const stagesSrc = fs.readFileSync(STAGES, "utf8");
const DOUBT_SRC = 'e.line = `Question design (doubt): the question voices a concern about ${project.brand}. Doubt: "${r.concern}"`;';
mustContain(stagesSrc, "build_stages_file.mts", DOUBT_SRC);
const CRITIC = `${EV}/labeling/g3/fill_critic_lines.mts`;
const criticSrc = fs.readFileSync(CRITIC, "utf8");
const CRITIC_SRC = 'const line = `Question design (doubt): the customer quotes a criticism someone raised about ${brand}. Criticism: "${crit}"`;';
mustContain(criticSrc, "fill_critic_lines.mts", CRITIC_SRC);

const fills: FillText = {
  aw_agnostic: tick("AW_TOPICS_AGNOSTIC"),
  flag_block_v02: tick("FLAG_BLOCK_V02"),
  flag_price_eg_v02: quoted("FLAG_PRICE_EG_V02"),
  flag_spec_eg_v02: quoted("FLAG_SPEC_EG_V02"),
  flag_intro: quoted("FLAG_INTRO"),
  specs_weigh: quoted("SPECS_WEIGH"),
};
const stance = record("STANCE");
const settled = record("SETTLED_STAGES");
const lines = {
  criteria: tick("CRITERIA_R4"),
  defensive: tick("DEFENSIVE_LINE"),
  stance,
  stance_line: "Question design (keep or leave, {{STAGE}}): {{WHO}}.{{WORRY}}",
  worry: ' Worry: "{{CONCERN}}"',
  doubt: 'Question design (doubt): the question voices a concern about {{BRAND}}. Doubt: "{{CONCERN}}"',
  critic: 'Question design (doubt): the customer quotes a criticism someone raised about {{BRAND}}. Criticism: "{{CRITICISM}}"',
  settled,
  settled_line: "Question design (settled customer, {{STAGE}}): {{WHO}}.",
};

// ------------------------------------------------------------- systems
type Inputs = { brand: string; codes: string[]; defs: Record<string, string>; price: string[]; spec: string[]; files: string[] };
function trackerInputs(t: string): Inputs {
  const dir = t === "sephora" ? `${EV}/finetune/warm_sephora/inputs` : `${EV}/labeling/exports_2026-10-12`;
  const taxF = t === "sephora" ? `${dir}/taxonomy_sephora_ratified.json` : `${dir}/taxonomy_${t}_ratified.json`;
  const defsF = t === "sephora" ? `${dir}/defs_sephora_ratified.json` : `${dir}/defs_${t}.json`;
  const fvF = `${dir}/flag_vocab_${t}.json`;
  const tax = JSON.parse(fs.readFileSync(taxF, "utf8"));
  const fv = JSON.parse(fs.readFileSync(fvF, "utf8"));
  return {
    brand: tax.brand,
    codes: tax.reason_taxonomy,
    defs: JSON.parse(fs.readFileSync(defsF, "utf8")),
    price: fv.price_forms.map((x: { display: string }) => x.display),
    spec: fv.spec_forms.map((x: { display: string }) => x.display),
    files: [taxF, defsF, fvF],
  };
}
const TRAINED = ["american_express", "jira", "google_pixel", "netflix", "doritos"];
const SETC = new Set(["business_case", "expansion", "ecosystem", "advocacy"]);
/** tracker -> schema key -> the distinct system texts its rows carry */
const seen = new Map<string, Map<string, Set<string>>>();
const sources: Record<string, string> = {};
const add = (t: string, key: string, s: string) => {
  const m = seen.get(t) ?? seen.set(t, new Map()).get(t)!;
  (m.get(key) ?? m.set(key, new Set()).get(key)!).add(s);
};
for (const t of TRAINED) {
  const reqF = `${EV}/labeling/v2_build/training/${t}_v2_all.jsonl`;
  const manF = `${EV}/labeling/v2_build/training/${t}_v2_all.manifest.jsonl`;
  const drfF = `${EV}/labeling/v04_dr/recode/requests_${t}_drf.jsonl`;
  const drsF = `${EV}/labeling/v04_dr/setc_recode/requests_${t}_drs.jsonl`;
  for (const f of [reqF, manF, drfF, drsF]) sources[path.relative(EV, f)] = sha(f);
  const reqs = jl(reqF), man = jl(manF);
  if (reqs.length !== man.length) fail(`${t}: v2 request/manifest length differs`);
  const drf = new Map(jl(drfF).map((r) => [String(r.custom_id).replace(/^drf_/, ""), r]));
  reqs.forEach((r, i) => {
    const m = man[i];
    if (m.id !== r.custom_id) fail(`${t}: v2 manifest order differs at ${i}`);
    let s = r.params.system[0].text as string;
    if (m.schema === "choice" || m.schema === "premium") {
      const d = drf.get(m.id);
      if (!d) fail(`${t}: ${m.id} has no drc3 request`);
      if (d.params.messages[0].content !== r.params.messages[0].content) fail(`${t}: ${m.id} drc3 user differs`);
      s = d.params.system[0].text;
    }
    add(t, m.schema, s);
  });
  for (const r of jl(drsF)) add(t, "settled", r.params.system[0].text);
}
{
  const reqF = `${EV}/finetune/warm_sephora/requests_sephora_ratified.jsonl`;
  const manF = `${EV}/labeling/v04_dr/sephora_arm/eval_sephora_v04.manifest.jsonl`;
  for (const f of [reqF, manF]) sources[path.relative(EV, f)] = sha(f);
  const man = new Map(jl(manF).map((m) => [m.id, m]));
  for (const r of jl(reqF)) {
    const m = man.get(r.custom_id);
    if (!m) fail(`sephora: ${r.custom_id} not in the arm manifest`);
    add("sephora", SETC.has(m.schema) ? "settled" : m.schema, r.params.system[0].text);
  }
}

const templates = new Map<string, { tpl: string; trackers: string[] }>();
for (const [t, bySchema] of seen) {
  const inp = trackerInputs(t);
  for (const f of inp.files) sources[path.relative(EV, f)] = sha(f);
  for (const [key, set] of bySchema) {
    if (set.size !== 1) fail(`${t}/${key}: ${set.size} distinct system texts (want 1)`);
    let s = [...set][0];
    if (s.includes("{{")) fail(`${t}/${key}: stored system already contains "{{"`);
    const slot = (text: string, name: string, want: number) => {
      const n = count(s, text);
      if (n !== want) fail(`${t}/${key}: slot ${name} occurs ${n}x (want ${want})`);
      if (want) s = s.split(text).join(`{{${name}}}`);
    };
    const v2 = key !== "settled";
    const aware = key === "awareness_pr" || key === "awareness_ce";
    slot(codeLines(inp.codes, inp.defs), "CODES", 1);
    if (v2) slot(flagBlock(fills, inp.price, inp.spec), "FLAGS", 1);
    if (aware) slot(awAgnosticText(fills, inp.brand), "AW_AGNOSTIC", 1);
    s = s.split(inp.brand).join("{{BRAND}}");
    const prev = templates.get(key);
    if (!prev) templates.set(key, { tpl: s, trackers: [t] });
    else if (prev.tpl !== s) {
      const a = prev.tpl.split("\n"), b = s.split("\n");
      const i = a.findIndex((l, k) => l !== b[k]);
      fail(`${key}: ${t} gives a different template than ${prev.trackers.join("/")} at line ${i + 1}:\n  ${JSON.stringify(a[i])}\n  ${JSON.stringify(b[i])}`);
    } else prev.trackers.push(t);
  }
}
const WANT = ["awareness_pr", "awareness_ce", "choice", "criteria", "premium", "value", "alt_defensive", "objections", "churn_renewal", "settled"];
for (const k of WANT) {
  const e = templates.get(k);
  if (!e) fail(`no stored rows for schema ${k}`);
  if (e!.trackers.length < 2) fail(`${k}: only ${e!.trackers.join("")} carries it - a one-tracker template cannot be proven a function of its inputs`);
}
sources[path.relative(EV, BB)] = sha(BB);
sources[path.relative(EV, CRITIC)] = sha(CRITIC);
sources["repo:scripts/build_stages_file.mts"] = sha(STAGES);

const out = {
  id: "v04_prompts_2026-10-29",
  note: "Derived by scripts/derive_coder_contract.mts from the frozen request bodies procerno_reason_coder v0.4/v0.5 and the Sephora reasons adapter were trained and evaluated on. Do not edit by hand.",
  systems: Object.fromEntries(WANT.map((k) => [k, templates.get(k)!.tpl])),
  agreed_by: Object.fromEntries(WANT.map((k) => [k, templates.get(k)!.trackers])),
  lines,
  fills,
  sources: Object.fromEntries(Object.entries(sources).sort()),
};
const text = JSON.stringify(out, null, 1) + "\n";
for (const k of WANT) console.log(`${k.padEnd(14)} ${String(out.systems[k].length).padStart(6)} chars  agreed by ${out.agreed_by[k].join(", ")}`);
if (CHECK) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  // sources hashes may legitimately be re-stamped; the contract text may not.
  const strip = (j: string) => { const o = JSON.parse(j); delete o.sources; return JSON.stringify(o); };
  if (!cur || strip(cur) !== strip(text)) fail(`${path.relative(REPO, OUT)} differs from a fresh derivation`);
  console.log("check OK: the committed contract equals a fresh derivation");
} else {
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(REPO, OUT)}`);
}
