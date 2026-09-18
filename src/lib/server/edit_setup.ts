import { store } from "@/lib/store";
import {
  composeInstrument,
  participationMask,
  reviewJourneyFit,
  reviewScenarioFit,
  type Moderators,
  type ScenarioSpec,
} from "@/lib/engine/instrument";
import type { Project } from "@/lib/types";

const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

/** A zero-run tracker's instrument rendered back into the wizard-draft
 * shape - shared by the /api setup route and the server-rendered /app
 * page (the Edit setup click opens the wizard in ONE navigation).
 * Returns null when the tracker has runs (locked) or was not built with
 * the Landscape setup. Callers have already checked access. */
export async function buildEditSetupDraft(project: Project) {
  const id = project.id;
  const runs = await store.listRuns(id);
  if (runs.length > 0) return null;
  const intents = await store.listIntents(id);
  const moderators = (project as unknown as { moderators?: string | null }).moderators;
  if (!moderators || intents.length === 0) return null;
  const base = JSON.parse(moderators) as Moderators;
  const prompts = await store.listPrompts(id);
  const situations = [...new Set(intents.map((i) => i.situation).filter(Boolean))] as string[];
  const desc = new Map<string, string>();
  try {
    const composed = await composeInstrument({
      category: project.category,
      audience: project.audience,
      noWait: true,
      meta: { brand: project.brand, source: "edit_setup" },
    });
    if (composed) {
      for (const s of [...composed.scenarios, ...composed.reserve]) {
        desc.set(s.label, s.description);
      }
    }
  } catch {
    // cold read: descriptions stay blank, all editable
  }
  const scenarios: ScenarioSpec[] = situations.map((label) => ({
    label,
    description: desc.get(label) ?? "",
    journey: null,
  }));
  const stages = participationMask(base, scenarios);
  const keptStages = [...new Set(intents.map((i) => i.stage))];
  const byIntent = new Map<string, { text: string; asker?: string }[]>();
  for (const p of prompts) {
    const key = (p as unknown as { intent_id: string | null }).intent_id;
    if (!key) continue;
    const list = byIntent.get(key) ?? [];
    list.push({ text: p.text, asker: (p as unknown as { asker?: string | null }).asker ?? undefined });
    byIntent.set(key, list);
  }
  const cells = intents.map((i) => ({
    stage: i.stage,
    layer: i.layer,
    situation: i.situation,
    angle: i.angle,
    mode: i.mode,
    text: i.text,
    phrasings: (byIntent.get(i.id) ?? []).filter((p) => norm(p.text) !== norm(i.text)),
  }));
  const [fit, journeyFit] = await Promise.all([
    reviewScenarioFit({
      brand: project.brand,
      category: project.category,
      scenarios: scenarios.map((s) => ({ label: s.label, description: s.description })),
      meta: { brand: project.brand, source: "edit_setup" },
    }).catch(() => null),
    reviewJourneyFit({
      brand: project.brand,
      category: project.category,
      base,
      meta: { brand: project.brand, source: "edit_setup" },
    }).catch(() => null),
  ]);
  const rows = scenarios.map((s) => ({
    label: s.label,
    description: s.description,
    journey: null,
    suggested: true,
    on: true,
    original: { label: s.label, description: s.description },
    first: { label: s.label, description: s.description },
  }));
  return {
    id: null,
    brand: project.brand,
    category: project.category,
    audience: project.audience,
    competitors: project.competitors,
    prompts: null,
    wizard: {
      mode: "grid",
      step: "prompts",
      studyName: project.name,
      engineSet: project.engine_set,
      grid: {
        step: "phrasings",
        fit,
        journeyFit,
        moderators: base,
        stages: stages.map((s) => ({
          key: s.key, label: s.label, layer: s.layer, situational: s.situational,
          rivals: s.rivals, tag: s.tag, recommended: s.recommended,
          columns: s.columns, hint: s.hint, why: s.why,
        })),
        keptStages,
        scenarios: scenarios.map((s) => ({ label: s.label, description: s.description, journey: null })),
        scenarioRows: rows,
        reserve: [],
        baselineCellCount: cells.length,
        cells,
      },
    },
  };
}
