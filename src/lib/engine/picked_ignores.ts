import { store } from "../store";
import { countPickedIgnores } from "./picked_count";
import type { DictionaryEntry } from "../types";

export { countPickedIgnores } from "./picked_count";

/** The counts for a tracker, on the run its dashboard shows (latest complete,
 * else the latest run with codes). Empty when nothing is coded. Never throws:
 * a failed read must not take the board down with it. */
export async function loadPickedIgnores(
  projectId: string,
  entries: DictionaryEntry[]
): Promise<Map<string, number>> {
  try {
    const source = await store.getCodesSource(projectId);
    if (!source) return new Map();
    const runs = await store.listRuns(projectId);
    let run = runs.find((r) => r.status === "complete") ?? null;
    if (!run) {
      for (const r of runs) {
        if ((await store.countAnswerCodes(r.id, source)) > 0) { run = r; break; }
      }
    }
    if (!run) return new Map();
    return countPickedIgnores(await store.listAnswerPicks(run.id, source), entries);
  } catch (err) {
    console.error("[picked_ignores] count failed:", err);
    return new Map();
  }
}
