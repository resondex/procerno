"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

/** Wire shape of a stored taxonomy proposal (discovery + consolidation). */
export interface ProposalWire {
  brand: string;
  rows: number;
  source: string;
  codes: {
    code: string;
    rows: number;
    incidence: number;
    scope: "in" | "boundary";
    recommendation: string;
    why: string;
    evidence_phrases: string[];
  }[];
}

export default function TaxonomyConfirm({
  id,
  brand,
  status,
  ratified,
  proposal,
}: {
  id: string;
  brand: string;
  status: string;
  ratified: string[];
  proposal: ProposalWire | null;
}) {
  // Pre-check per recommendation: in-scope codes on, boundary codes off
  // until a human says otherwise.
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      (proposal?.codes ?? []).map((c) => [c.code, c.scope !== "boundary"])
    )
  );
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(status === "ratified");
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(
    () => (proposal?.codes ?? []).filter((c) => checked[c.code]).map((c) => c.code),
    [proposal, checked]
  );

  if (!proposal) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 grid gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Your market&apos;s arguments
        </h1>
        <p className="text-sm opacity-70">
          {status === "ratified"
            ? `The taxonomy is ratified (${ratified.length} codes).`
            : "No proposal yet - it appears here after the first collection is discovery-coded."}
        </p>
        <Link className="text-sm underline" href={`/projects/${id}`}>
          Back to tracker
        </Link>
      </main>
    );
  }

  const confirm = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/projects/${id}/taxonomy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: selected }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(j?.error ?? `save failed (${res.status})`);
      return;
    }
    setDone(true);
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Your market&apos;s arguments
        </h1>
        <p className="text-sm opacity-70 mt-1">
          Measured from {proposal.rows.toLocaleString()} AI answers about the{" "}
          {brand} market - no list was assumed; these are the arguments the
          answers actually make. Confirm the dimensions your dashboard will
          track.
        </p>
      </div>

      {done && (
        <div className="card p-4 text-sm">
          Taxonomy ratified ({selected.length || ratified.length} codes).{" "}
          <Link className="underline" href={`/projects/${id}`}>
            Back to tracker
          </Link>
        </div>
      )}

      <div className="grid gap-3">
        {proposal.codes.map((c) => (
          <label
            key={c.code}
            className={`card p-4 grid gap-1 cursor-pointer ${
              checked[c.code] ? "" : "opacity-60"
            }`}
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={!!checked[c.code]}
                disabled={done}
                onChange={(e) =>
                  setChecked((m) => ({ ...m, [c.code]: e.target.checked }))
                }
              />
              <span className="font-medium">{c.code}</span>
              <span className="text-xs opacity-70">
                argued in {(c.incidence * 100).toFixed(1)}% of answers
              </span>
              {c.scope === "boundary" && (
                <span className="text-xs rounded px-1.5 py-0.5 border border-amber-500 text-amber-600">
                  boundary - your call
                </span>
              )}
            </div>
            <div className="text-xs opacity-70 pl-7">{c.why}</div>
            <div className="text-xs opacity-50 pl-7">
              e.g. {c.evidence_phrases.slice(0, 5).join(", ")}
            </div>
          </label>
        ))}
      </div>

      {!done && (
        <div className="flex items-center gap-4">
          <button
            className="rounded bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
            onClick={confirm}
            disabled={saving || selected.length < 3}
          >
            {saving ? "Saving..." : `Confirm ${selected.length} codes`}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      )}
    </main>
  );
}
