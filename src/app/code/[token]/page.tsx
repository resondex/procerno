import { buildCodingPayload } from "@/lib/server/coding_payload";
import CodingView from "./coding_view";

/** Server-rendered: the assignment loads with the HTML; a returning
 * coder's saved progress rehydrates client-side (their name lives in
 * localStorage). */
export default async function CodingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const payload = await buildCodingPayload(token, null);
  if (!payload) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-xl font-semibold mb-2">Link unavailable</h1>
        <p className="text-sm text-ink-2">
          This coding link is invalid or the assignment no longer exists.
        </p>
      </main>
    );
  }
  const wire = JSON.parse(JSON.stringify(payload));
  return <CodingView token={token} initialPayload={wire} />;
}
