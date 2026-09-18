import { store } from "@/lib/store";
import { METRIC_DEFINITION, METRIC_QUESTION } from "@/lib/coding_questions";
import type { AssignmentItem } from "@/lib/engine/human_coding";

/** The coder-facing payload for one assignment token - shared by the
 * /api/coding route and the server-rendered /code page so the two paths
 * can never drift. Null = unknown token. */
export async function buildCodingPayload(token: string, coder: string | null) {
  if (!/^[a-f0-9]{32,64}$/.test(token)) return null;
  const assignment = await store.getCodingAssignmentByToken(token);
  if (!assignment) return null;
  const items = JSON.parse(assignment.items) as AssignmentItem[];
  const [responses, prompts, project] = await Promise.all([
    store.listResponses(assignment.run_id),
    store.listPrompts(assignment.project_id),
    store.getProject(assignment.project_id),
  ]);
  const responseById = new Map(responses.map((r) => [r.id, r]));
  const promptById = new Map(prompts.map((p) => [p.id, p]));
  let codes: Record<string, boolean> = {};
  if (coder) {
    const all = await store.listHumanCodes(assignment.id);
    codes = Object.fromEntries(
      all
        .filter((c) => c.coder === coder)
        .map((c) => [`${c.response_id}|${c.brand_norm}`, c.verdict === 1])
    );
  }
  return {
    name: assignment.name,
    metric: assignment.metric,
    question: METRIC_QUESTION[assignment.metric],
    definition: METRIC_DEFINITION[assignment.metric],
    category: project?.category ?? "",
    items: items.flatMap((it) => {
      const r = responseById.get(it.response_id);
      if (!r) return [];
      return [
        {
          responseId: it.response_id,
          brand: it.brand,
          brandNorm: it.brand_norm,
          prompt: promptById.get(r.prompt_id)?.text ?? "",
          text: r.text,
        },
      ];
    }),
    codes,
  };
}
