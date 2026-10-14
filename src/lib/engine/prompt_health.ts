import { store } from "../store";
import { tagCosts } from "../cost_log";
import { buildCanonicalizer } from "./metrics";
import { apiKeyConfigured, openaiClient } from "./providers";
import { PROMPT_HEALTH_MODEL } from "./models";
import { promptsForRun } from "./surfaces";


// Contract (2026-10-14): the model returns ONLY the defective prompts; a
// prompt we sent that is absent from the list is healthy and its flag clears.
// The old one-verdict-per-prompt contract failed two ways: gpt-6-luna returned
// only the defective prompts anyway (8 of 12 test runs), so flags never
// cleared, and gpt-5-mini timed out writing 280 verdicts on AmEx's battery.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    defective: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          // Anchors each verdict to its prompt; an id we did not send is
          // discarded rather than guessed at.
          id: { type: "string" },
          reason: { type: "string" },
          alternatives: { type: "array", items: { type: "string" } },
        },
        required: ["id", "reason", "alternatives"],
      },
    },
  },
  required: ["defective"],
} as const;

/**
 * Post-run health check: a prompt whose answers recall mostly out-of-category
 * brands was probably measuring the wrong conversation. Runs after every
 * completed run — a battery that was healthy at launch can drift as the
 * assistants change — flagging defective prompts and proposing anchored
 * alternatives for refielding. Flags are advisory and recomputed each run;
 * nothing is retired automatically.
 */
export async function analyzePromptHealth(
  projectId: string,
  runId: string
): Promise<void> {
  tagCosts({ purpose: "run:prompt_health" });
  if (!apiKeyConfigured()) return;
  const project = await store.getProject(projectId);
  if (!project) return;
  const [run, prompts, intents, responses, mentions, dictionary] = await Promise.all([
    store.getRun(runId),
    store.listPrompts(projectId),
    store.listIntents(projectId),
    store.listResponseMeta(runId),
    store.listMentionsForRun(runId),
    store.getDictionary(projectId),
  ]);
  if (!run) return;
  const canon = buildCanonicalizer(dictionary);

  // Only prompts this run asked: a skip wave sending a worry prompt with
  // zero answers would let the model clear the flag its monthly wave set.
  const unbranded = promptsForRun(run, prompts, intents).filter(
    (p) => p.theme !== "branded"
  );
  const mentionsByResponse = new Map<string, string[]>();
  for (const m of mentions) {
    const list = mentionsByResponse.get(m.response_id) ?? [];
    list.push(canon.canonical(m.brand));
    mentionsByResponse.set(m.response_id, list);
  }
  // Weigh brands by how many answers named them, not by how many distinct
  // names appeared. A prompt whose answers are overwhelmingly on-category but
  // which picked up a long tail of one-off strays used to read as heavily
  // defective, because every stray counted the same as the category leader.
  const perPrompt = unbranded.map((p) => {
    const rows = responses.filter((r) => r.prompt_id === p.id);
    const counts = new Map<string, number>();
    for (const r of rows) {
      for (const b of new Set(mentionsByResponse.get(r.id) ?? [])) {
        counts.set(b, (counts.get(b) ?? 0) + 1);
      }
    }
    const brands = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([brand, answers]) => ({ brand, answers }));
    return { prompt: p, answers: rows.length, brands };
  });

  const res = await openaiClient().chat.completions.create({
    model: PROMPT_HEALTH_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You audit a brand-visibility study's prompts after a run. " +
          `The study measures the category "${project.category}". For each ` +
          "prompt you get its id, how many answers it collected, and the " +
          "brands those answers recalled with the number of answers naming " +
          "each. Judge by that weight, not by the length of the brand list: " +
          "one stray brand named in a single answer is noise, while a " +
          "non-category brand named in most answers is evidence. A " +
          "prompt is defective when a substantial share of recall " +
          "is OUTSIDE the category — evidence the prompt was read as being " +
          "about something broader or different (e.g. it asked for 'a tool' " +
          "without naming the category at all, so answers ranged across " +
          "unrelated kinds of product). A few stray adjacent brands in an " +
          "otherwise " +
          "on-category answer set are normal — do not flag those. For each " +
          "defective prompt: reason = one plain sentence naming what the " +
          "answers drifted to; alternatives = exactly 2 rewritten prompts " +
          "that keep the original intent, length, and casual register but " +
          "anchor the category unmistakably. Never include brand names in " +
          "alternatives. List ONLY the defective prompts, each with its id " +
          "echoed back exactly; every prompt you leave out is treated as " +
          "healthy. An empty list means every prompt is healthy.",
      },
      {
        role: "user",
        content: JSON.stringify(
          perPrompt.map((x) => ({
            id: x.prompt.id,
            prompt: x.prompt.text,
            answers: x.answers,
            recalled_brands: x.brands,
          }))
        ),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "health", strict: true, schema: SCHEMA },
    },
  });
  // No parsable reply means no verdicts: leave every flag as it was. Under
  // this contract an empty default would read as "all healthy" and clear them.
  const content = res.choices[0]?.message?.content;
  let defective: { id: string; reason: string; alternatives: string[] }[];
  try {
    defective = (JSON.parse(content ?? "") as { defective: typeof defective }).defective;
    if (!Array.isArray(defective)) throw new Error("no defective list");
  } catch {
    console.warn(
      `prompt health check (${project.brand}): unreadable reply - flags unchanged`
    );
    return;
  }

  const sent = new Set(perPrompt.map((x) => x.prompt.id));
  const byId = new Map(
    defective.filter((r) => sent.has(r.id)).map((r) => [r.id, r])
  );
  const unknown = defective.length - byId.size;
  if (unknown > 0) {
    console.warn(
      `prompt health check (${project.brand}): ${unknown} verdicts named ids we did not send or repeated an id - discarded`
    );
  }
  let flagged = 0;
  for (const x of perPrompt) {
    const r = byId.get(x.prompt.id);
    if (r) flagged++;
    await store.setPromptFlag(
      x.prompt.id,
      r
        ? {
            reason: r.reason || "answers drifted off-category",
            alternatives: r.alternatives.slice(0, 2),
          }
        : null
    );
  }
  console.log(
    `prompt health check (${project.brand}): ${flagged}/${perPrompt.length} prompts flagged`
  );
}
