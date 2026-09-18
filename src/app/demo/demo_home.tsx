"use client";

import { useEffect, useState } from "react";
import { SetupWizard } from "../app/setup_wizard";
import type { EngineOption } from "../components/engine_picker";

/**
 * The unlisted setup demo: walk the full Buyer Landscape wizard for any
 * brand - the real flow, the real generation - but nothing persists: no
 * draft, no tracker, no run. Reached via /api/demo/enter?key=... which
 * sets the demo cookie the setup APIs accept.
 */
export default function DemoHome({
  initialDenied,
  initialEngines,
}: {
  initialDenied: boolean;
  initialEngines: EngineOption[];
}) {
  const [brand, setBrand] = useState("");
  const engineOptions = initialEngines;
  const denied = initialDenied;
  const [open, setOpen] = useState(false);

  /** The golden-fixture roster - reviewed setups with warm caches, so
   * every step lands instantly. Deliberately a fixed list: brands people
   * merely typed into the demo are never surfaced here. */
  const GOLDEN = [
    "jira", "Sephora", "Google Pixel", "Google Nest", "Netflix", "Purple",
    "AG1", "American Express", "Doritos", "athenahealth", "PwC",
  ];

  return (
    <div className="min-h-screen bg-surface-1">
      <div className="mx-auto grid max-w-xl gap-6 px-6 py-20">
        <div className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
            Procerno · setup demo
          </span>
          <h1 className="text-[22px] font-semibold tracking-tight">
            Walk the Buyer Landscape setup
          </h1>
          <p className="m-0 text-sm text-ink-2">
            Pick any brand and go through the same setup customers use - the
            market read, the buying scenarios, the coverage map, and every
            prompt written for you. Nothing is created and no scan runs.
          </p>
        </div>
        {denied ? (
          <p className="m-0 rounded-lg border border-line bg-surface p-4 text-sm text-ink-2">
            This demo needs its invite link - ask whoever sent you here for
            the full URL.
          </p>
        ) : (
          <div className="card grid gap-3 bg-surface p-5">
            <label className="grid gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
              Your brand
              <input
                className="input w-full"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && brand.trim()) setOpen(true);
                }}
                placeholder="e.g. Notion"
              />
            </label>
            <button
              type="button"
              onClick={() => brand.trim() && setOpen(true)}
              disabled={!brand.trim()}
              className="btn-primary w-fit"
            >
              Start Buyer Landscape
            </button>
            <div className="grid gap-1.5 border-t border-line pt-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                Or open an example
              </span>
              <div className="flex flex-wrap gap-1.5">
                {GOLDEN.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => {
                      setBrand(g);
                      setOpen(true);
                    }}
                    className="rounded-full bg-primary-soft px-2.5 py-1 text-[12px] font-medium text-primary hover:opacity-80"
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 p-[3vh_3vw]">
          <div
            role="dialog"
            aria-modal="true"
            className="card mx-auto h-full w-full max-w-[1200px] overflow-hidden bg-surface"
          >
            <SetupWizard
              key={brand.trim()}
              mode="grid"
              brand={brand.trim()}
              draft={null}
              engineOptions={engineOptions}
              demo
              onClose={() => setOpen(false)}
              onCreated={() => setOpen(false)}
              onDraftsChanged={() => {}}
            />
          </div>
        </div>
      )}
    </div>
  );
}
