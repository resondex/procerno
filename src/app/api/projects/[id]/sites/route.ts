import { NextResponse } from "next/server";
import { z } from "zod";
import { isShareContext, requireAuth, requireProject } from "@/lib/auth";
import { store } from "@/lib/store";
import { loadViewData } from "@/lib/engine/view_data";
import { dashboardRun } from "@/lib/engine/prompt_health";
import { checkBoard, citedSitesOf, loadSiteOwnerInputs } from "@/lib/engine/site_owner";
import { siteBoard, siteOwnerResolver, type OwnerFrom } from "@/lib/engine/facts/sources";
import { buildResolver } from "@/lib/engine/brand_resolve";
import { addOwner, parseSiteOwners, removeOwner, siteFromInput, withSiteOwners } from "@/lib/site_owners";
import type { DictionaryEntry, Project } from "@/lib/types";

export const maxDuration = 60;

/**
 * The Brand dictionary's Sites tab (2026-11-19): which sites count as each brand's own when the AI cites a source.
 * Whose a site is follows the three owner rules (engine/facts/sources.ts) - what a person entered here, else the saved
 * model check of the run the dashboard shows (site_owner.ts), else the name match - exactly as the Data page reads it.
 *
 * GET (read access): per brand in analysis, the tracker's own first, its sites with how many answers of the shown run
 * cite each and where the ownership comes from; plus the most cited sites that belong to nobody.
 * POST (write access; a share-link reader gets 403): { action: "add" | "remove", site, brand } writes the person's
 * record for that site = its current owners plus / minus the brand. No model call either way.
 */

/** Unclaimed sites listed for a person to assign. */
const UNCLAIMED = 30;

async function ownerContext(project: Project) {
  const run = await dashboardRun(project.id);
  const dictionary: DictionaryEntry[] = await store.getDictionary(project.id);
  const targetKey = buildResolver(dictionary)(project.brand).key;
  const board = checkBoard(project, dictionary);
  const inputs = run ? await loadSiteOwnerInputs(project, run.id, dictionary) : { entered: {}, checked: {} };
  // Owners resolve over every brand in analysis (the set the fact layer uses); the tab lists the board.
  const resolve = siteOwnerResolver(siteBoard(project.brand, dictionary, targetKey), targetKey, inputs);
  return { run, board, resolve };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) return project;
  const { run, board, resolve } = await ownerContext(project);
  const data = run ? await loadViewData(run, project) : null;
  const cited = data ? await citedSitesOf(data) : [];
  const answersOf = new Map(cited.map((c) => [c.site, c.answers]));
  const entered = parseSiteOwners(await store.getSiteOwners(project.id));

  const perBrand = new Map<string, { site: string; answers: number; from: OwnerFrom }[]>(board.map((b) => [b.key, []]));
  const unclaimed: { site: string; answers: number }[] = [];
  // Every cited site, then the sites a person entered that no answer cites yet.
  const sites = [...cited.map((c) => c.site), ...Object.keys(entered).filter((s) => !answersOf.has(s)).sort()];
  for (const site of sites) {
    const { owners, from } = resolve(site);
    if (owners.length === 0) {
      if (answersOf.has(site) && unclaimed.length < UNCLAIMED) unclaimed.push({ site, answers: answersOf.get(site)! });
      continue;
    }
    for (const o of owners) perBrand.get(o)?.push({ site, answers: answersOf.get(site) ?? 0, from: from! });
  }
  return NextResponse.json({
    runId: run?.id ?? null,
    brands: board.map((b) => ({ id: b.key, name: b.name, you: b.client, sites: perBrand.get(b.key) ?? [] })),
    unclaimed,
  });
}

const bodySchema = z.object({
  action: z.enum(["add", "remove"]),
  site: z.string().min(1).max(500),
  brand: z.string().min(1).max(200),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  if (isShareContext(auth)) return NextResponse.json({ error: "a shared link is read only" }, { status: 403 });
  const { id } = await params;
  const project = await requireProject(id, auth, { write: true });
  if (project instanceof NextResponse) return project;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { action, brand } = parsed.data;
  const got = siteFromInput(parsed.data.site);
  if ("error" in got) return NextResponse.json({ error: got.error }, { status: 400 });
  const { site } = got;
  const { board, resolve } = await ownerContext(project);
  if (!board.some((b) => b.key === brand)) return NextResponse.json({ error: "That brand is not in your analysis." }, { status: 400 });

  const current = resolve(site).owners;
  const owners = action === "add" ? addOwner(current, brand) : removeOwner(current, brand);
  const map = withSiteOwners(parseSiteOwners(await store.getSiteOwners(project.id)), site, owners, new Date().toISOString());
  await store.setSiteOwners(project.id, JSON.stringify(map));
  return NextResponse.json({ ok: true, site, owners });
}
