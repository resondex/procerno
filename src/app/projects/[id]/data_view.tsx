"use client";

import { useCallback, useState } from "react";
import JourneySection from "./journey_view";
import { MetricsSection } from "./metrics_view";

/**
 * The Data page (2026-11-10, the analysis redesign): the quiet analyst tier.
 * Two tabs - By question type (the Stations read, with the buyer filter that
 * now lives here only) and Build a table (the metrics pivot). Each tab mounts
 * on first visit and stays mounted, so switching never refetches.
 */

export type DataTab = "types" | "build";

export default function DataPage({
  runId,
  tab,
  onTab,
  jump,
}: {
  runId: string;
  tab: DataTab;
  onTab: (t: DataTab) => void;
  /** The brief's request to open a station (its by-assistant table); `n` makes a repeat click a new request. */
  jump?: { station: "consideration"; n: number };
}) {
  const [room, setRoom] = useState("");
  const [rooms, setRooms] = useState<string[]>([]);
  const onRooms = useCallback(
    (rs: string[]) => setRooms((prev) => (prev.length === rs.length && prev.every((r, i) => r === rs[i]) ? prev : rs)),
    []
  );
  const [seen, setSeen] = useState<Set<DataTab>>(() => new Set([tab]));
  if (!seen.has(tab)) setSeen(new Set(seen).add(tab));
  const seg = (on: boolean) => `rounded-full px-4 py-1 text-[13.5px] ${on ? "bg-primary-soft font-semibold text-ink" : "text-ink-3 hover:text-ink-2"}`;
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ${
      on ? "border-[var(--color-primary)] bg-primary-soft text-primary" : "border-line text-ink-2 hover:border-ink-3"
    }`;
  return (
    <section className="grid gap-5 pb-10">
      <div>
        <h2 className="mb-1 text-xl font-semibold tracking-tight text-ink">Data</h2>
        <p className="max-w-[70ch] text-[14px] text-ink-3">
          For analysts. Every question type read on its own, and a builder for your own tables. Nothing here is needed to read the wave.
        </p>
      </div>
      <div className="inline-flex justify-self-start rounded-full border border-line bg-surface p-[3px]" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "types"} className={seg(tab === "types")} onClick={() => onTab("types")}>
          By question type
        </button>
        <button type="button" role="tab" aria-selected={tab === "build"} className={seg(tab === "build")} onClick={() => onTab("build")}>
          Build a table
        </button>
      </div>
      {seen.has("types") && (
        <div className={tab === "types" ? "grid gap-5" : "hidden"}>
          {rooms.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[12px] text-ink-3">Buyer:</span>
              {["", ...rooms].map((rk) => (
                <button key={rk || "__all"} type="button" onClick={() => setRoom(rk)} aria-pressed={room === rk} className={chip(room === rk)}>
                  {rk === "" ? "All buyers" : rk}
                </button>
              ))}
            </div>
          )}
          <JourneySection runId={runId} room={room} onRoom={setRoom} onRooms={onRooms} jump={jump} />
        </div>
      )}
      {seen.has("build") && (
        <div className={tab === "build" ? "grid gap-5" : "hidden"}>
          <MetricsSection runId={runId} />
        </div>
      )}
    </section>
  );
}
