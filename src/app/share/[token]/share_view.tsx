"use client";

import { useEffect, useState } from "react";
import RunResults from "@/app/projects/[id]/run_results";

/**
 * The public face of a shared dashboard: same results surface the owner
 * sees, read-only — running, deleting, scheduling, and dictionary editing
 * are absent here and their APIs reject share sessions anyway.
 */
export default function ShareView({
  token,
  brand,
  runId,
  expiresAt,
}: {
  token: string;
  brand: string;
  runId: string | null;
  expiresAt: string;
}) {
  // The claim sets the share cookie the results APIs need - the header
  // renders instantly from server props, the results wait one claim.
  const [claimed, setClaimed] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/share/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? "This link didn't work.");
        }
        setClaimed(true);
      })
      .catch((e) => setClaimError((e as Error).message));
  }, [token]);
  return (
    <main className="mx-auto max-w-6xl px-6 py-10 grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {brand} — LLM visibility
        </h1>
        <p className="text-[13px] text-ink-3 mt-1">
          Shared read-only dashboard · link expires{" "}
          {new Date(expiresAt).toLocaleString()}
        </p>
      </div>
      {claimError ? (
        <p className="text-sm text-ink-2">{claimError}</p>
      ) : !runId ? (
        <p className="text-sm text-ink-3">
          This tracker has no completed runs yet.
        </p>
      ) : claimed ? (
        <RunResults runId={runId} />
      ) : null}
    </main>
  );
}
