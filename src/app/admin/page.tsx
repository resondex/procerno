import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { loadAdminData } from "@/lib/server/admin_data";
import AdminConsole from "./admin_console";

/** Server-rendered: the console's orgs, members, projects and staff
 * roster arrive with the HTML; mutations refresh via the API as before. */
export default async function AdminPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const data = await loadAdminData(auth);
  const wire = data ? JSON.parse(JSON.stringify(data)) : null;
  return <AdminConsole initialData={wire} />;
}
