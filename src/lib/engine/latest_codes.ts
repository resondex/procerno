import { store } from "../store";
import { coderSource } from "./coder";
import type { AnswerCodes, Project, Run } from "../types";

/** A tracker's latest coded run's codes: the codes source first, then the
 * coder's (dict_queue's order); coded-held runs count. `run` pins one run. */
export async function latestCodes(
  project: Pick<Project, "id">,
  run?: Run
): Promise<AnswerCodes[]> {
  const codesSource = await store.getCodesSource(project.id);
  const coder = coderSource(await store.getReasonsAdapter(project.id));
  const runs = run ? [run] : await store.listRuns(project.id);
  for (const r of runs) {
    let codes: AnswerCodes[] = codesSource ? await store.listAnswerCodes(r.id, codesSource) : [];
    if (codes.length === 0 && coder !== codesSource) codes = await store.listAnswerCodes(r.id, coder);
    if (codes.length > 0) return codes;
  }
  return [];
}
