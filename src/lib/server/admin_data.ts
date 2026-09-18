import { isStaff, type AuthContext } from "@/lib/auth";
import { store } from "@/lib/store";
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
  return {
    staff,
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
