"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DictionaryEntry } from "@/lib/types";

const OTHER_CANONICAL = "Other";

interface Pill {
  name: string; // original casing, shown on the pill
  norm: string;
  entryId: string; // entry that owns the name right now (server state)
  kind: "canonical" | "alias";
  homeStatus: DictionaryEntry["status"];
  locked: boolean; // active canonicals anchor their bucket — not draggable
  confirmed: boolean;
  moved: boolean; // user dragged it this session → white
  /** Measured review rationale from the suggestion guard, when flagged. */
  note?: string;
  /** The merge target the flag is about (drives the tooltip's wording). */
  noteTarget?: string | null;
  /** Placed mechanically (family/variant) - collapses into a per-bucket
   * "+N variants" chip until expanded. */
  auto?: boolean;
}

interface Bucket {
  key: string; // entryId | "__other__" | "__ignore__" | "new:<entryId>"
  kind: "brand" | "new" | "other" | "ignore";
  entryId: string | null;
  label: string;
  originalLabel: string;
  pills: Pill[];
}

interface Suggestion {
  entryId: string;
  name: string;
  action: "merge" | "approve" | "ignore";
  mergeIntoId: string | null;
  mergeIntoName: string | null;
  rationale: string;
}

function norm(s: string) {
  return s.trim().toLowerCase();
}

/**
 * Identify view: every raw name the answers surfaced is a pill; buckets are
 * the analyzable groupings. Drag to re-file, confirm to commit. Red = never
 * confirmed, blue = confirmed earlier, white = moved this session.
 */
export default function IdentifyTab({
  projectId,
  dict,
  onApplied,
  observations,
  hideConfirm,
  registerConfirm,
  targetBrand,
}: {
  projectId: string;
  dict: DictionaryEntry[];
  onApplied: () => Promise<void>;
  /** projects.brand_observations JSON - observed mention counts from the
   * discovery brands pass. Optional: without it the board renders unsized. */
  observations?: string | null;
  /** Gate mode: the step footer owns the confirm button, so the board's own
   * top-right one is hidden and confirmAll is handed up instead. */
  hideConfirm?: boolean;
  registerConfirm?: (fn: () => Promise<void>) => void;
  /** The tracker's own brand - its card always sorts first. */
  targetBrand?: string;
}) {
  // Observed sizing: entry_id-matched counts size the brand buckets; name
  // keys size the pending pills. Tier words, no raw numbers - preliminary
  // until coding.
  const obs = (() => {
    try {
      return observations
        ? (JSON.parse(observations) as {
            rows: number;
            observed: { name: string; entry_id: string | null; answers: number }[];
          })
        : null;
    } catch {
      return null;
    }
  })();
  const obsByEntry = new Map<string, number>();
  const obsByName = new Map<string, number>();
  for (const o of obs?.observed ?? []) {
    if (o.entry_id) obsByEntry.set(o.entry_id, (obsByEntry.get(o.entry_id) ?? 0) + o.answers);
    obsByName.set(norm(o.name), o.answers);
  }
  const maxObs = Math.max(1, ...(obs?.observed ?? []).map((o) => o.answers));
  const tierOf = (n: number) => {
    const f = n / (obs?.rows || 1);
    return f >= 0.3
      ? { label: "DOMINANT", cls: "text-primary" }
      : f >= 0.1
        ? { label: "MAJOR", cls: "text-ink" }
        : f >= 0.02
          ? { label: "COMMON", cls: "text-ink-2" }
          : { label: "OCCASIONAL", cls: "text-ink-3" };
  };
  const bucketSize = (b: { entryId: string | null }) =>
    b.entryId && obsByEntry.has(b.entryId) ? obsByEntry.get(b.entryId)! : null;
  const roleOf = (entryId: string | null) =>
    dict.find((e) => e.id === entryId)?.role ?? null;
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  // Delayed indicator: cached suggestions resolve in <1s — flashing
  // "Sorting…" for that beat reads as flicker, so it only shows when the
  // pass is genuinely slow.
  const [showSorting, setShowSorting] = useState(false);
  useEffect(() => {
    if (!suggesting) {
      setShowSorting(false);
      return;
    }
    const t = setTimeout(() => setShowSorting(true), 600);
    return () => clearTimeout(t);
  }, [suggesting]);
  const [confirming, setConfirming] = useState(false);
  // Buckets whose mechanically-placed variant pills are expanded.
  const [variantsOpen, setVariantsOpen] = useState<Set<string>>(new Set());
  const [dragNorm, setDragNorm] = useState<string | null>(null);
  const [suggestSummary, setSuggestSummary] = useState<{
    merged: number;
    proposed: number;
    ignored: number;
  } | null>(null);
  // Entry ids the suggestion pass has already placed — avoids re-suggesting.
  const suggestedFor = useRef<Set<string>>(new Set());
  // Engine-ignored names: never rendered as pills - a receipt line with a
  // reveal button instead. Confirm commits them as rejected.
  const [autoIgnored, setAutoIgnored] = useState<
    { entryId: string; name: string; rationale: string }[]
  >([]);
  const [showAutoIgnored, setShowAutoIgnored] = useState(false);
  // First paint races the suggestion pass: until it resolves, every pending
  // name would flash in the tray un-sorted, then snap into place. The tray
  // waits for the pass instead.
  const [passDone, setPassDone] = useState(false);
  // Verbatim evidence popover: real answer snippets for a clicked pill,
  // split by whether the parent brand is named in the same answer.
  const [examples, setExamples] = useState<{
    name: string;
    parent: string | null;
    loading: boolean;
    counts?: { withParent: number; alone: number };
    withParent?: string[];
    alone?: string[];
    embedding?: string[];
  } | null>(null);

  async function openExamples(name: string, parent: string | null) {
    setExamples({ name, parent, loading: true });
    try {
      const q = new URLSearchParams({ name, ...(parent ? { parent } : {}) });
      const res = await fetch(`/api/projects/${projectId}/dictionary/examples?${q}`);
      if (!res.ok) throw new Error();
      const d = await res.json();
      setExamples({
        name,
        parent,
        loading: false,
        counts: d.counts,
        withParent: d.withParent ?? [],
        alone: d.alone ?? [],
        embedding: d.embedding ?? [],
      });
    } catch {
      setExamples(null);
    }
  }

  /** Bold standalone occurrences of the name - never the ones sitting
   * inside a longer phrase ("Prime" inside "Prime Video" stays plain, so
   * the quote reads as the parent's name, not a separate Prime). */
  function highlight(snippet: string, name: string, embedding: string[]) {
    const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const phrases = embedding.filter(
      (ph) => ph.toLowerCase() !== name.toLowerCase()
    );
    const splitter = new RegExp(
      `(${[...phrases.map(escRe), escRe(name)].join("|")})`,
      "ig"
    );
    return snippet.split(splitter).map((part, i) =>
      part && part.toLowerCase() === name.toLowerCase() ? (
        <b key={i} className="text-ink">{part}</b>
      ) : (
        part
      )
    );
  }

  const buildBuckets = useCallback(
    (entries: DictionaryEntry[]): Bucket[] => {
      const out: Bucket[] = [];
      const aliasOwners = new Set(
        entries
          .filter((e) => e.status === "active")
          .flatMap((e) => e.aliases)
      );
      const other = entries.find(
        (e) => e.canonical === OTHER_CANONICAL && e.status === "active"
      );
      for (const e of entries) {
        if (e.status !== "active" || e === other) continue;
        out.push({
          key: e.id,
          kind: "brand",
          entryId: e.id,
          label: e.display_name ?? e.canonical,
          originalLabel: e.display_name ?? e.canonical,
          pills: [
            {
              name: e.canonical,
              norm: norm(e.canonical),
              entryId: e.id,
              kind: "canonical",
              homeStatus: "active",
              locked: false,
              confirmed: e.confirmed.includes(norm(e.canonical)),
              moved: false,
            },
            ...e.aliases.map((a) => ({
              name: a,
              norm: a,
              entryId: e.id,
              kind: "alias" as const,
              homeStatus: "active" as const,
              locked: false,
              confirmed: e.confirmed.includes(a),
              moved: false,
            })),
          ],
        });
      }
      out.push({
        key: "__other__",
        kind: "other",
        entryId: other?.id ?? null,
        label: OTHER_CANONICAL,
        originalLabel: OTHER_CANONICAL,
        pills: (other?.aliases ?? []).map((a) => ({
          name: a,
          norm: a,
          entryId: other!.id,
          kind: "alias" as const,
          homeStatus: "active" as const,
          locked: false,
          confirmed: other!.confirmed.includes(a),
          moved: false,
        })),
      });
      out.push({
        key: "__ignore__",
        kind: "ignore",
        entryId: null,
        label: "Ignore",
        originalLabel: "Ignore",
        pills: entries
          .filter(
            (e) =>
              e.status === "rejected" &&
              // Merge remnants live on as aliases elsewhere — one pill only.
              !aliasOwners.has(norm(e.canonical)) &&
              e.canonical !== OTHER_CANONICAL
          )
          .map((e) => ({
            name: e.canonical,
            norm: norm(e.canonical),
            entryId: e.id,
            kind: "canonical" as const,
            homeStatus: "rejected" as const,
            locked: false,
            confirmed: e.confirmed.includes(norm(e.canonical)),
            moved: false,
          })),
      });
      return out;
    },
    []
  );

  // Rebuild from server state whenever the dictionary changes - but carry
  // the board's un-applied placements over. A background dict refresh (the
  // dashboard revalidates on mount) used to race the suggestion pass and
  // wipe every pre-placed pill, leaving the tray "ungrouped" until a lucky
  // reload reordered the race.
  useEffect(() => {
    setBuckets((prev) => {
      const fresh = buildBuckets(dict);
      if (prev.length === 0) return fresh;
      const stillPending = new Set(
        dict.filter((e) => e.status === "pending").map((e) => e.id)
      );
      // Placements worth keeping: pending pills placed anywhere (by the
      // suggestion pass or by hand), and active pills the user has dragged.
      const carried: { pill: Pill; from: Bucket }[] = [];
      for (const b of prev) {
        for (const p of b.pills) {
          if (p.homeStatus === "pending") {
            if (p.entryId && stillPending.has(p.entryId)) {
              carried.push({ pill: p, from: b });
            }
          } else if (p.moved) {
            carried.push({ pill: p, from: b });
          }
        }
      }
      if (carried.length === 0) return fresh;
      for (const { pill, from } of carried) {
        // Remove the pill from wherever the server build put it, then
        // restore it to the bucket the board had it in.
        for (const fb of fresh) {
          fb.pills = fb.pills.filter(
            (fp) => !(fp.norm === pill.norm && fp.entryId === pill.entryId)
          );
        }
        let dest = fresh.find((fb) => fb.key === from.key);
        if (!dest && from.kind === "new") {
          dest = { ...from, pills: [] };
          fresh.splice(fresh.length - 2, 0, dest);
        }
        dest?.pills.push({ ...pill });
      }
      return fresh.filter(
        (b) => (b.kind !== "new" && b.kind !== "brand") || b.pills.length > 0
      );
    });
  }, [dict, buildBuckets]);

  // Sub-1% emerged names are noise the board does not serve: they get no
  // pill, no suggestion, no drag target - just a one-line receipt below the
  // tray. The cut is presentation-only and self-healing: the next run's
  // aggregation re-scores every name, so anything that crosses 1% appears
  // then. Names without an observation row (queued from a coding pass, not
  // the brands pass) can't be scored and are always served.
  const lowSignal = (e: DictionaryEntry) => {
    if (!obs || obs.rows === 0) return false;
    const n = obsByName.get(norm(e.canonical));
    return n !== undefined && n < obs.rows * 0.01;
  };
  const pendingEntries = dict.filter(
    (e) => e.status === "pending" && !lowSignal(e)
  );
  const lowSignalCount = dict.filter(
    (e) => e.status === "pending" && lowSignal(e)
  ).length;
  const unplacedPending = pendingEntries.filter(
    (e) =>
      !buckets.some((b) => b.pills.some((p) => p.entryId === e.id)) &&
      !autoIgnored.some((a) => a.entryId === e.id)
  );

  // Pre-organize newly discovered names by suggestion.
  useEffect(() => {
    const fresh = pendingEntries.filter(
      (e) => !suggestedFor.current.has(e.id)
    );
    if (fresh.length === 0 || suggesting) {
      if (fresh.length === 0 && !suggesting) setPassDone(true);
      return;
    }
    fresh.forEach((e) => suggestedFor.current.add(e.id));
    setSuggesting(true);
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/dictionary/suggest`, {
          method: "POST",
        });
        if (!res.ok) {
          // Un-mark so the next effect run retries instead of stranding the
          // whole tray unplaced for the rest of the mount.
          fresh.forEach((e) => suggestedFor.current.delete(e.id));
          return;
        }
        const suggestions: Suggestion[] = (await res.json()).suggestions ?? [];
        // Compute the whole placement plan PURELY, before any state update.
        // (Collecting side effects inside the setBuckets updater ran on
        // React's schedule, not ours - the ignore list was read while still
        // empty and the engine-ignored names fell through to the tray.)
        const activeIds = new Set(
          dict.filter((e) => e.status === "active").map((e) => e.id)
        );
        const approveIds = new Set(
          suggestions.filter(
            (x) => x.action === "approve" && pendingEntries.some((e) => e.id === x.entryId)
          ).map((x) => x.entryId)
        );
        const plans: { entry: DictionaryEntry; s: Suggestion; target: string | null }[] = [];
        const ignoredNow: { entryId: string; name: string; rationale: string }[] = [];
        const summary = { merged: 0, proposed: 0, ignored: 0 };
        for (const sug of suggestions) {
          const entry = pendingEntries.find((e) => e.id === sug.entryId);
          if (!entry) continue;
          if (sug.action === "ignore") {
            summary.ignored++;
            ignoredNow.push({
              entryId: entry.id,
              name: entry.canonical,
              rationale: sug.rationale ?? "",
            });
            continue;
          }
          const target =
            sug.action === "merge" &&
            sug.mergeIntoId &&
            (activeIds.has(sug.mergeIntoId) || approveIds.has(sug.mergeIntoId))
              ? sug.mergeIntoId
              : null;
          if (sug.action === "approve" || !target) summary.proposed++;
          else summary.merged++;
          plans.push({ entry, s: sug, target });
        }
        if (ignoredNow.length > 0) {
          setAutoIgnored((prev) => [
            ...prev.filter((x) => !ignoredNow.some((y) => y.entryId === x.entryId)),
            ...ignoredNow,
          ]);
        }
        setBuckets((prev) => {
          const next = prev.map((b) => ({ ...b, pills: [...b.pills] }));
          const mkPill = (entry: DictionaryEntry, sug: Suggestion): Pill => ({
            name: entry.canonical,
            norm: norm(entry.canonical),
            entryId: entry.id,
            kind: "canonical",
            homeStatus: "pending",
            locked: false,
            confirmed: false,
            moved: false,
            ...(/- review\)/.test(sug.rationale ?? "")
              ? { note: sug.rationale, noteTarget: sug.mergeIntoName }
              : {}),
            ...(/^(extends the tracked brand|variant of|follows )/.test(sug.rationale ?? "")
              ? { auto: true }
              : {}),
          });
          const placed = (id: string) =>
            next.some((b) => b.pills.some((pp) => pp.entryId === id));
          // Pass 1: approvals and target-less merges found their buckets, so
          // family children have somewhere to land whatever the list order.
          for (const { entry, s: sug, target } of plans) {
            if (target || placed(entry.id)) continue;
            next.splice(next.length - 2, 0, {
              key: `new:${entry.id}`,
              kind: "new",
              entryId: entry.id,
              label: entry.canonical,
              originalLabel: entry.canonical,
              pills: [mkPill(entry, sug)],
            });
          }
          // Pass 2: merges into actives or the buckets pass 1 created.
          for (const { entry, s: sug, target } of plans) {
            if (!target || placed(entry.id)) continue;
            const b = next.find((x) => x.entryId === target);
            if (b) b.pills.push(mkPill(entry, sug));
          }
          return next;
        });
        setSuggestSummary(summary);
      } finally {
        setSuggesting(false);
        setPassDone(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEntries.length, projectId]);

  function placePills(pills: Pill[], toKey: string, next: Bucket[]): Bucket[] {
    const anchor = pills.find((p) => p.kind === "canonical") ?? pills[0];
    if (toKey === "__new__") {
      next.splice(next.length - 2, 0, {
        key: `new:${anchor.entryId}:${anchor.norm}`,
        kind: "new",
        entryId: anchor.kind === "canonical" ? anchor.entryId : null,
        label: anchor.name,
        originalLabel: anchor.name,
        pills,
      });
      return next;
    }
    const target = next.find((b) => b.key === toKey);
    if (!target) return next;
    target.pills = [...target.pills, ...pills];
    return next;
  }

  function movePill(pillNorm: string, toKey: string) {
    setBuckets((prev) => {
      const src = prev.find((b) => b.pills.some((p) => p.norm === pillNorm));
      if (!src || src.key === toKey) return prev;
      const pill = src.pills.find((p) => p.norm === pillNorm)!;
      // Dragging a group's anchor name takes the whole group with it — the
      // grouping IS the anchor's entry, so its variants travel together.
      const groupMove =
        pill.kind === "canonical" &&
        pill.homeStatus === "active" &&
        src.kind === "brand";
      const moving = (groupMove ? src.pills : [pill]).map((p) => ({
        ...p,
        moved: true,
        auto: false, // a hand-moved pill never re-collapses
      }));
      const movingNorms = new Set(moving.map((p) => p.norm));
      const next = prev
        .map((b) => ({
          ...b,
          pills:
            b.key === src.key
              ? b.pills.filter((p) => !movingNorms.has(p.norm))
              : [...b.pills],
        }))
        // Groups with no pills left disappear.
        .filter(
          (b) =>
            (b.kind !== "new" && b.kind !== "brand") || b.pills.length > 0
        );
      return placePills(moving, toKey, next);
    });
  }

  /** A staged (never-suggested) pending name entering the board on drop. */
  function dropStaged(entryId: string, name: string, toKey: string) {
    setBuckets((prev) => {
      if (prev.some((b) => b.pills.some((p) => p.entryId === entryId)))
        return prev;
      return placePills(
        [
          {
            name,
            norm: norm(name),
            entryId,
            kind: "canonical",
            homeStatus: "pending",
            locked: false,
            confirmed: false,
            moved: true,
          },
        ],
        toKey,
        prev.map((b) => ({ ...b, pills: [...b.pills] }))
      );
    });
  }

  function revealAutoIgnored() {
    setBuckets((prev) => {
      const next = prev.map((b) => ({ ...b, pills: [...b.pills] }));
      const ig = next.find((b) => b.key === "__ignore__");
      if (!ig) return prev;
      for (const a of autoIgnored) {
        if (next.some((b) => b.pills.some((p) => p.entryId === a.entryId))) continue;
        ig.pills.push({
          name: a.name,
          norm: norm(a.name),
          entryId: a.entryId,
          kind: "canonical",
          homeStatus: "pending",
          locked: false,
          confirmed: false,
          moved: false,
          note: a.rationale,
        });
      }
      return next;
    });
    setShowAutoIgnored(true);
  }

  function hideAutoIgnored() {
    // Pills still sitting in Ignore go back behind the receipt; anything the
    // user dragged elsewhere stays placed and leaves the receipt's list.
    const ids = new Set(autoIgnored.map((a) => a.entryId));
    const rescued = new Set<string>();
    setBuckets((prev) =>
      prev.map((b) => {
        if (b.key !== "__ignore__") {
          for (const p of b.pills) {
            if (ids.has(p.entryId)) rescued.add(p.entryId);
          }
          return b;
        }
        return {
          ...b,
          pills: b.pills.filter((p) => !ids.has(p.entryId)),
        };
      })
    );
    if (rescued.size > 0) {
      setAutoIgnored((prev) => prev.filter((a) => !rescued.has(a.entryId)));
    }
    setShowAutoIgnored(false);
  }

  async function confirmAll() {
    setConfirming(true);
    try {
      type Act = Record<string, unknown>;
      const approves: Act[] = [];
      const renames: Act[] = [];
      const moves: Act[] = [];
      const merges: Act[] = [];
      for (const b of buckets) {
        // Entries whose anchor pill sits in this bucket: their merge/reject
        // carries all their aliases, so alias pills of the same entry that
        // traveled along need no separate action.
        const groupedHere = new Set(
          b.pills
            .filter((p) => p.kind === "canonical" && p.homeStatus === "active")
            .map((p) => p.entryId)
        );
        const covered = (p: Pill) =>
          p.kind === "alias" && groupedHere.has(p.entryId);
        if (b.kind === "new") {
          // A name promoted to its own brand. Canonical anchors approve in
          // place; alias anchors are detached into a fresh entry, and the
          // rest of the bucket targets the anchor by name (its id may not
          // exist until the batch runs).
          const anchor =
            b.pills.find((p) => p.kind === "canonical") ?? b.pills[0];
          if (anchor) {
            if (anchor.kind === "canonical") {
              approves.push({ entryId: anchor.entryId, action: "approve" });
              if (b.label.trim() && b.label.trim() !== anchor.name) {
                renames.push({
                  entryId: anchor.entryId,
                  action: "rename",
                  displayName: b.label.trim(),
                });
              }
            } else {
              approves.push({
                entryId: anchor.entryId,
                action: "promote_alias",
                alias: anchor.name,
                ...(b.label.trim() && b.label.trim() !== anchor.name
                  ? { displayName: b.label.trim() }
                  : {}),
              });
            }
            for (const p of b.pills) {
              if (p === anchor || covered(p)) continue;
              const target =
                anchor.kind === "canonical"
                  ? { mergeIntoId: anchor.entryId }
                  : { mergeIntoName: anchor.name };
              if (p.kind === "alias") {
                moves.push({
                  entryId: p.entryId,
                  action: "move_alias",
                  alias: p.name,
                  to: "entry",
                  ...target,
                });
              } else {
                merges.push({ entryId: p.entryId, action: "merge", ...target });
              }
            }
          }
        } else if (b.kind === "brand") {
          if (b.label.trim() && b.label.trim() !== b.originalLabel) {
            renames.push({
              entryId: b.entryId,
              action: "rename",
              displayName: b.label.trim(),
            });
          }
          for (const p of b.pills) {
            if (p.entryId === b.entryId || covered(p)) continue; // home/rode along
            if (p.kind === "alias") {
              moves.push({
                entryId: p.entryId,
                action: "move_alias",
                alias: p.name,
                to: "entry",
                mergeIntoId: b.entryId,
              });
            } else {
              merges.push({
                entryId: p.entryId,
                action: "merge",
                mergeIntoId: b.entryId,
              });
            }
          }
        } else if (b.kind === "other") {
          for (const p of b.pills) {
            if ((b.entryId && p.entryId === b.entryId) || covered(p)) continue;
            if (p.kind === "alias") {
              moves.push({
                entryId: p.entryId,
                action: "move_alias",
                alias: p.name,
                to: "other",
              });
            } else {
              merges.push({ entryId: p.entryId, action: "merge_other" });
            }
          }
        } else {
          for (const p of b.pills) {
            if (p.homeStatus === "rejected" || covered(p)) continue;
            if (p.kind === "alias") {
              moves.push({
                entryId: p.entryId,
                action: "move_alias",
                alias: p.name,
                to: "ignore",
              });
            } else {
              merges.push({ entryId: p.entryId, action: "reject" });
            }
          }
        }
      }
      // Engine-ignored names commit as rejected alongside the board -
      // unless they're currently visible as pills, in which case the bucket
      // walk above already covered them.
      for (const a of autoIgnored) {
        if (buckets.some((b) => b.pills.some((p) => p.entryId === a.entryId)))
          continue;
        merges.push({ entryId: a.entryId, action: "reject" });
      }
      const actions = [...approves, ...renames, ...moves, ...merges];
      if (actions.length > 0) {
        await fetch(`/api/projects/${projectId}/dictionary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actions }),
        });
      }
      const allNames = [
        ...buckets.flatMap((b) => b.pills.map((p) => p.name)),
        ...autoIgnored.map((a) => a.name),
      ];
      if (allNames.length > 0) {
        await fetch(`/api/projects/${projectId}/dictionary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "confirm", names: allNames }),
        });
      }
      suggestedFor.current.clear();
      setAutoIgnored([]);
      setShowAutoIgnored(false);
      await onApplied();
    } finally {
      setConfirming(false);
    }
  }

  // Latest confirmAll, handed to the gate footer once.
  const confirmAllRef = useRef<() => Promise<void>>(async () => {});
  confirmAllRef.current = confirmAll;
  useEffect(() => {
    registerConfirm?.(() => confirmAllRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerConfirm]);

  const unconfirmedCount = buckets.reduce(
    (n, b) => n + b.pills.filter((p) => !p.confirmed || p.moved).length,
    0
  );

  /** Drop handlers for a bucket — spread on the whole card so any point in
   * the box accepts the pill, not just the pill row. */
  function dropProps(toKey: string) {
    return {
      onDragOver: (e: React.DragEvent) => e.preventDefault(),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const n = e.dataTransfer.getData("text/pill");
        if (n) movePill(n, toKey);
        const staged = e.dataTransfer.getData("text/staged");
        if (staged) {
          const s = JSON.parse(staged) as { entryId: string; name: string };
          dropStaged(s.entryId, s.name, toKey);
        }
        setDragNorm(null);
      },
    };
  }

  function bucketBody(b: Bucket) {
    const open = variantsOpen.has(b.key);
    const collapsible = (p: Pill) =>
      !p.moved && (p.auto === true || (p.kind === "alias" && b.kind === "brand"));
    const autos = b.pills.filter(collapsible);
    // Order: anchor first, plain pills, flagged-for-review LAST; the
    // expanded group renders as one enclosed cluster after the anchor.
    const isAnchor = (p: Pill) =>
      p.kind === "canonical" && p.homeStatus === "active" && b.kind === "brand";
    const loose = b.pills.filter((p) => !collapsible(p));
    const shown = [
      ...loose.filter((p) => isAnchor(p)),
      ...loose.filter((p) => !isAnchor(p) && !p.note),
      ...loose.filter((p) => !isAnchor(p) && p.note),
    ];
    const pillSpan = (p: Pill, orderVal = 0) => (
          <span
            key={p.norm}
            style={{ order: orderVal }}
            draggable={!p.locked}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/pill", p.norm);
              setDragNorm(p.norm);
            }}
            onDragEnd={() => setDragNorm(null)}
            title={
              p.note
                ? undefined
                : p.kind === "canonical" && p.homeStatus === "active"
                  ? "Group anchor — dragging it moves the whole group"
                  : p.confirmed && !p.moved
                    ? "Confirmed"
                    : p.moved
                      ? "Moved — will be saved on confirm"
                      : "New — needs your confirmation"
            }
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[13px] font-medium select-none ${
              p.locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"
            } ${
              p.moved
                ? "bg-white border-line text-ink"
                : p.confirmed
                  ? "bg-primary-soft border-primary/30 text-primary"
                  : "bg-danger/10 border-danger/30 text-danger"
            } ${p.note ? "group relative !bg-amber-400/15 !border-amber-500/50 !text-amber-800" : ""} ${dragNorm === p.norm ? "opacity-40" : ""}`}
            onClick={
              p.note
                ? () => openExamples(p.name, p.noteTarget ?? null)
                : p.kind === "canonical" &&
                    p.homeStatus === "active" &&
                    b.kind === "brand" &&
                    autos.length > 0
                  ? () =>
                      setVariantsOpen((prev) => {
                        const next = new Set(prev);
                        if (next.has(b.key)) next.delete(b.key);
                        else next.add(b.key);
                        return next;
                      })
                  : undefined
            }
          >
            {p.name}
            {p.kind === "canonical" &&
              p.homeStatus === "active" &&
              b.kind === "brand" &&
              autos.length > 0 && (
                <span className="ml-1.5 text-[11px] font-normal opacity-60">
                  {open
                    ? "· collapse"
                    : `· ${autos.length} grouped name${autos.length === 1 ? "" : "s"}`}
                </span>
              )}
            {p.note && (
              <span className="pointer-events-none absolute left-0 top-full z-30 mt-1.5 hidden w-72 rounded-lg border border-line bg-surface p-3 text-left shadow-lg group-hover:block">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                  Flagged for review
                </span>
                {p.noteTarget && (
                  <span className="mt-1 block text-[12px] font-normal leading-snug text-ink">
                    Left here, answers naming &ldquo;{p.name}&rdquo; count as{" "}
                    <b>{p.noteTarget}</b>.
                  </span>
                )}
                <span className="mt-1 block text-[12px] font-normal leading-snug text-ink-2">
                  Drag it to its own bucket to track it separately, or into
                  Ignore to not count it. Click for real answer examples.
                </span>
                <span className="mt-1.5 block text-[11px] font-normal leading-snug text-ink-3">
                  {p.note}
                </span>
              </span>
            )}
          </span>
    );

    return (
      <div className="flex flex-wrap gap-1.5 min-h-9 rounded-lg p-1 -m-1">
        {open && autos.length > 0 && (
          <span className="order-2 inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed border-line bg-ink/[0.03] px-1.5 py-1">
            {autos.map((p) => pillSpan(p))}
          </span>
        )}
        {shown.map((p, idx) => pillSpan(p, isAnchor(p) ? 1 : 3 + idx))}
        {b.pills.length === 0 && (
          <span className="text-xs text-ink-3 self-center px-1">
            drop names here
          </span>
        )}
      </div>
    );
  }

  // Serve the board all at once: until the suggestion pass resolves,
  // render one quiet loading state instead of buckets that reshuffle as
  // placements, the summary line, and the receipt pop in one by one.
  if (!passDone && pendingEntries.length > 0) {
    return (
      <div className="grid gap-4 py-8 justify-center">
        <p className="text-[13px] text-ink-3">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 mr-1.5 align-[-1px] rounded-full border-2 border-line border-t-primary animate-spin"
          />
          Preparing your brand board…
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-danger/60" /> new —
            confirm below
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-primary/60" />{" "}
            confirmed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border border-line bg-white" />{" "}
            moved this session
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border border-amber-500/50 bg-amber-400/15" />{" "}
            flagged for review — hover for why and click for examples
          </span>
        </div>
        {!hideConfirm && (
          <button
            type="button"
            onClick={confirmAll}
            disabled={confirming || unconfirmedCount === 0}
            className="btn-primary px-3 py-1.5 text-[13px] inline-flex items-center gap-2"
          >
            {confirming && (
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin"
              />
            )}
            {confirming
              ? "Saving…"
              : unconfirmedCount > 0
                ? `Confirm layout (${unconfirmedCount})`
                : "All confirmed"}
          </button>
        )}
      </div>
      {(showSorting || (suggestSummary && !suggesting)) && (
        <p className="text-[13px] text-ink-3">
          {suggesting ? (
            <>
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 mr-1.5 align-[-1px] rounded-full border-2 border-line border-t-primary animate-spin"
              />
              Sorting {unplacedPending.length || "new"} names into suggested
              groups…
            </>
          ) : (
            <>
              Suggestions placed: {suggestSummary!.merged} grouped into
              existing brands, {suggestSummary!.proposed} proposed as new
              brands, {suggestSummary!.ignored} ignored. Rearrange anything,
              then confirm.
            </>
          )}
        </p>
      )}
      {passDone && !suggesting && unplacedPending.length > 0 && (
        <div className="rounded-lg border border-dashed border-line p-3">
          <p className="text-xs text-ink-3 mb-2">
            New names — drag into a group:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unplacedPending.map((e) => (
              <span
                key={e.id}
                draggable
                onDragStart={(ev) => {
                  ev.dataTransfer.setData(
                    "text/staged",
                    JSON.stringify({ entryId: e.id, name: e.canonical })
                  );
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 bg-danger/10 px-2.5 py-1 text-[13px] font-medium text-danger cursor-grab"
              >
                {e.canonical}
                {obs && obsByName.has(norm(e.canonical)) && (
                  <span className={`text-[9px] font-bold tracking-wide ${tierOf(obsByName.get(norm(e.canonical))!).cls}`}>
                    {tierOf(obsByName.get(norm(e.canonical))!).label}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
      {autoIgnored.length > 0 && (
        <p className="text-xs text-ink-3">
          {autoIgnored.length} name{autoIgnored.length === 1 ? "" : "s"}{" "}
          auto-ignored by measured rules (redundant vocabulary, own-context
          brands, off-category scenery)
          {showAutoIgnored ? " - put in Ignore. " : " - saved as Ignore when you confirm. "}
          <button
            type="button"
            onClick={showAutoIgnored ? hideAutoIgnored : revealAutoIgnored}
            className="underline hover:text-ink"
          >
            {showAutoIgnored ? "hide them" : "show them in Ignore"}
          </button>
        </p>
      )}
      {examples && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-6"
          onClick={() => setExamples(null)}
        >
          <div
            className="card w-full max-w-xl max-h-[75vh] overflow-auto bg-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <h3 className="text-sm font-semibold">
                &ldquo;{examples.name}&rdquo; in real answers
              </h3>
              <button
                type="button"
                onClick={() => setExamples(null)}
                className="text-ink-3 hover:text-ink text-lg leading-none"
              >
                ×
              </button>
            </div>
            {examples.loading ? (
              <p className="text-[13px] text-ink-3">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 mr-1.5 align-[-1px] rounded-full border-2 border-line border-t-primary animate-spin"
                />
                Pulling examples from the collected answers…
              </p>
            ) : (
              <div className="grid gap-4">
                {examples.parent && (
                  <div>
                    <p className="section-label mb-1.5">
                      Named alongside {examples.parent} —{" "}
                      {examples.counts?.withParent.toLocaleString()} answers
                    </p>
                    {(examples.withParent ?? []).map((q, i) => (
                      <p key={i} className="mb-1.5 rounded-lg border border-line bg-white/50 px-3 py-2 text-[13px] italic leading-snug text-ink-2">
                        {highlight(q, examples.name, examples.embedding ?? [])}
                      </p>
                    ))}
                    {(examples.withParent ?? []).length === 0 && (
                      <p className="text-[12px] text-ink-3">no examples found</p>
                    )}
                  </div>
                )}
                <div>
                  <p className="section-label mb-1.5">
                    Named {examples.parent ? "without " + examples.parent : "in answers"} —{" "}
                    {examples.counts?.alone.toLocaleString()} answers
                  </p>
                  {(examples.alone ?? []).map((q, i) => (
                    <p key={i} className="mb-1.5 rounded-lg border border-line bg-white/50 px-3 py-2 text-[13px] italic leading-snug text-ink-2">
                      {highlight(q, examples.name, examples.embedding ?? [])}
                    </p>
                  ))}
                  {(examples.alone ?? []).length === 0 && (
                    <p className="text-[12px] text-ink-3">no examples found</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {lowSignalCount > 0 && (
        <p className="text-xs text-ink-3">
          {lowSignalCount} more name{lowSignalCount === 1 ? "" : "s"} appeared
          in under 1% of answers and {lowSignalCount === 1 ? "was" : "were"}{" "}
          left out as noise - they resurface automatically if a future run
          crosses that floor.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {buckets
          .filter((b) => b.kind === "brand")
          .sort((a, b) => {
            const isT = (x: Bucket) =>
              !!targetBrand &&
              x.pills.some(
                (p) =>
                  p.kind === "canonical" && norm(p.name) === norm(targetBrand)
              );
            return Number(isT(b)) - Number(isT(a));
          })
          .map((b) => (
            <div key={b.key} className="card p-4" {...dropProps(b.key)}>
              <input
                value={b.label}
                onChange={(e) =>
                  setBuckets((prev) =>
                    prev.map((x) =>
                      x.key === b.key ? { ...x, label: e.target.value } : x
                    )
                  )
                }
                className="w-full bg-transparent text-sm font-semibold mb-2 outline-none border-b border-transparent focus:border-line"
                title="Grouping label — used across all reports and dashboards"
              />
              {obs && (
                <div className="mb-2 -mt-1 flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${roleOf(b.entryId) === "competitor" ? "bg-line text-ink-2" : "bg-primary/10 text-primary"}`}
                  >
                    {roleOf(b.entryId) === "competitor" ? "competitor" : "your brand"}
                  </span>
                  {bucketSize(b) !== null ? (
                    <span
                      className="flex items-center gap-1.5"
                      title="how often this brand appears in your collected answers - preliminary until coding"
                    >
                      <span className={`text-[10px] font-bold tracking-wide ${tierOf(bucketSize(b)!).cls}`}>
                        {tierOf(bucketSize(b)!).label}
                      </span>
                      <span className="h-1 w-14 overflow-hidden rounded-full bg-line">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(5, (bucketSize(b)! / maxObs) * 100)}%` }}
                        />
                      </span>
                    </span>
                  ) : (
                    <span
                      className="text-[10px] font-bold tracking-wide text-ink-3"
                      title="never mentioned in the collected answers"
                    >
                      NOT SEEN
                    </span>
                  )}
                </div>
              )}
              {bucketBody(b)}
            </div>
          ))}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">
          Proposed new brands (
          {buckets.filter((b) => b.kind === "new").length}) — each analyzes as
          its own brand
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {buckets
            .filter((b) => b.kind === "new")
            .map((b) => (
              <div key={b.key} className="card p-3" {...dropProps(b.key)}>
                <input
                  value={b.label}
                  onChange={(e) =>
                    setBuckets((prev) =>
                      prev.map((x) =>
                        x.key === b.key ? { ...x, label: e.target.value } : x
                      )
                    )
                  }
                  className="w-full bg-transparent text-[13px] font-semibold mb-1.5 outline-none border-b border-transparent focus:border-line"
                  title="Grouping label — used across all reports and dashboards"
                />
                {bucketBody(b)}
              </div>
            ))}
          <div
            className="card p-3 border-dashed grid place-items-center text-xs text-ink-3 min-h-16"
            {...dropProps("__new__")}
          >
            drop a name here to make it its own brand
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {buckets
          .filter((b) => b.kind === "other" || b.kind === "ignore")
          .map((b) => (
            <div
              key={b.key}
              className="card p-4 bg-surface-2/50"
              {...dropProps(b.key)}
            >
              <div
                className="text-sm font-semibold mb-2 text-ink-2"
                title={
                  b.kind === "other"
                    ? "Grouped into the analysis as Other — label is fixed"
                    : "Excluded from the analysis — raw data stays intact"
                }
              >
                {b.label}
              </div>
              {bucketBody(b)}
            </div>
          ))}
      </div>
      <p className="text-xs text-ink-3">
        Drag a name onto a group to file it. Labels on your groups are yours
        to edit and flow through every report; the underlying match strings
        are never destroyed, so any decision can be reversed later.
      </p>
    </div>
  );
}
