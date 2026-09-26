import { cookies } from "next/headers";
import { getAuth } from "@/lib/auth";
import { ENGINES } from "@/lib/engine/providers";
import DemoHome from "./demo_home";

/** Server-rendered: the demo gate (invite cookie or a real session) and
 * the engine roster resolve here, so the page needs no mount fetches. */
export default async function DemoPage() {
  const cookieStore = await cookies();
  const key = process.env.DEMO_ACCESS_KEY;
  const hasDemoCookie = Boolean(key) && cookieStore.get("ap_demo")?.value === key;
  const auth = hasDemoCookie ? { ok: true } : await getAuth();
  const engines = ENGINES.map((e) => ({
    id: e.id,
    label: e.label,
    vendor: e.vendor,
    available: Boolean(process.env[e.keyEnv]),
    keyEnv: e.keyEnv,
    mode: e.mode,
    retired: Boolean(e.successor),
  }));
  return <DemoHome initialDenied={!auth} initialEngines={engines} />;
}
