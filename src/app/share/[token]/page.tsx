import { shareLinkFor } from "@/lib/auth";
import { store } from "@/lib/store";
import ShareView from "./share_view";

/** Server-rendered: the link validates and the header data loads here,
 * so a client opening a share link sees the branded page immediately -
 * no "Opening the shared dashboard" beat. The client half claims the
 * share cookie before the results fetch. */
export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = await shareLinkFor(token);
  if (!link) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="text-xl font-semibold mb-2">Link unavailable</h1>
        <p className="text-sm text-ink-2">
          This share link is invalid or has expired.
        </p>
      </main>
    );
  }
  const project = await store.getProject(link.projectId);
  if (!project) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="text-xl font-semibold mb-2">Link unavailable</h1>
        <p className="text-sm text-ink-2">This tracker no longer exists.</p>
      </main>
    );
  }
  const runs = await store.listRuns(project.id);
  const latest = runs.find((r) => r.status === "complete");
  return (
    <ShareView
      token={token}
      brand={project.brand}
      runId={latest?.id ?? null}
      expiresAt={link.expiresAt}
    />
  );
}
