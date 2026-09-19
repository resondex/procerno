import { isStaff, type AuthContext } from "@/lib/auth";
import { store } from "@/lib/store";
import { answerCost, coderCost, requestFee, searchFee } from "@/lib/pricing";
import type { Org, OrgMember } from "@/lib/types";

/** The admin console's data - shared by the /api/admin route and the
 * server-rendered /admin page. Null = the caller is not an admin. */
export async function loadAdminData(auth: AuthContext) {
  const staff = auth.userId === null ? true : await isStaff(auth);
  const memberships = auth.email
    ? await store.listMembershipsForEmail(auth.email)
    : [];
  const adminOrgIds = memberships
    .filter((m) => m.role === "admin")
    .map((m) => m.org_id);
  if (!staff && adminOrgIds.length === 0) return null;
  const allOrgs = await store.listOrgs();
  const orgs: (Org & { members: OrgMember[] })[] = [];
  for (const org of allOrgs) {
    if (!staff && !adminOrgIds.includes(org.id)) continue;
    orgs.push({ ...org, members: await store.listOrgMembers(org.id) });
  }
  const projects = staff
    ? await store.listProjects()
    : await store.listProjectsByOrgIds(adminOrgIds);
  // Staff-only financials: metered answer tokens per run x engine and
  // metered extraction-coder tokens per answer, both priced exactly.
  let financials: unknown = null;
  if (staff) {
    const rows: {
      runId: string; project: string; brand: string; createdAt: string; status: string;
      answers: number; inTokens: number; outTokens: number; searches: number;
      answerCost: number; coderCost: number;
    }[] = [];
    for (const pr of projects.slice(0, 100)) {
      for (const run of await store.listRuns(pr.id)) {
        const responses = await store.listResponses(run.id);
        if (responses.length === 0 && run.status === "pending") continue;
        let inT = 0, outT = 0, searches = 0, cost = 0, coder = 0;
        for (const r of responses) {
          const rr = r as unknown as { model: string | null; input_tokens: number | null; output_tokens: number | null; search_count: number | null; coder_usage: string | null };
          inT += rr.input_tokens ?? 0;
          outT += rr.output_tokens ?? 0;
          searches += rr.search_count ?? 0;
          cost += answerCost(rr.model ?? run.model, rr.input_tokens ?? 0, rr.output_tokens ?? 0, rr.search_count ?? 0);
          coder += coderCost(rr.coder_usage);
        }
        rows.push({
          runId: run.id, project: pr.name, brand: pr.brand,
          createdAt: run.created_at, status: run.status,
          answers: responses.length, inTokens: inT, outTokens: outT, searches,
          answerCost: Math.round(cost * 100) / 100,
          coderCost: Math.round(coder * 100) / 100,
        });
      }
    }
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    financials = rows;
  }
  // Staff-only spend ledger: every vendor call since the ledger shipped,
  // grouped by purpose x model - includes setup/edit work and redone
  // passes that no response row remembers. Run spend appears here too, so
  // the ledger total and the run table overlap by design.
  let costLedger: unknown = null;
  if (staff) {
    const projectNames = new Map(projects.map((pr) => [pr.id, pr.brand]));
    const summary = await store.summarizeCostLog();
    costLedger = summary.map((row) => ({
      project: row.project_id ? projectNames.get(row.project_id) ?? "(deleted)" : null,
      purpose: row.purpose,
      model: row.model,
      calls: row.calls,
      inTokens: row.input_tokens,
      outTokens: row.output_tokens,
      searches: row.searches,
      cost:
        Math.round(
          ((answerCost(row.model, row.input_tokens, row.output_tokens, 0) -
            // answerCost adds one perRequest fee; this row is `calls` answers.
            requestFee(row.model, 1)) *
            // Vendor batches bill tokens at 50% of list; tool fees don't discount.
            (row.purpose === "run:answer_batch" ? 0.5 : 1) +
            requestFee(row.model, row.calls) +
            searchFee(row.model, row.searches)) * 10000
        ) / 10000,
    }));
  }
  return {
    staff,
    financials,
    costLedger,
    orgs,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      category: p.category,
      org_id: p.org_id,
      user_id: p.user_id,
      created_at: p.created_at,
    })),
    staffEmails: staff ? await store.listStaff() : [],
  };
}
