"use client";

import { useEffect, useState } from "react";
import type { DictionaryEntry } from "@/lib/types";
import type { ParentGroup, ParentSuggestions } from "@/lib/engine/parent_suggest";

const OTHER_CANONICAL = "Other";
/** Dismissed suggestion keys per project (parentKey of the company): a
 * per-viewer convenience, never shared state. */
const dismissKey = (projectId: string) => `parents_dismissed_${projectId}`;
function readDismissed(projectId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(dismissKey(projectId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function writeDismissed(projectId: string, keys: Set<string>) {
  try {
    window.localStorage.setItem(dismissKey(projectId), JSON.stringify([...keys]));
  } catch {
    /* storage blocked - the dismiss lasts this visit only */
  }
}

/**
 * Parents view: group analyzable brands under their parent company for
 * rollups. Drag a brand into a parent box (or onto the create zone to start
 * a new parent); changes save immediately. Brand-level analysis is
 * untouched - the parent is an extra label, not a merge.
 */
export default function ParentsTab({
  projectId,
  dict,
  onApplied,
  hideIntro,
}: {
  projectId: string;
  dict: DictionaryEntry[];
  onApplied: () => Promise<void>;
  /** Gate mode: the step header already explains the view, so the tab's own
   * intro paragraph would print the same thing twice. */
  hideIntro?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  // Optimistic: a dropped pill moves NOW; the server call syncs behind it
  // and the override lifts once the refreshed dictionary carries the truth
  // (or immediately if the server refuses) - same convention as the
  // analyzed toggle in Analysis settings.
  const [parentOverride, setParentOverride] = useState<
    Record<string, string | null>
  >({});

  // Suggested groups (parent_suggest.ts): fetched once per dictionary
  // version; nothing applies without a click.
  const [groups, setGroups] = useState<ParentGroup[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const dictSig = dict.map((e) => `${e.id}:${e.status}:${e.parent ?? ""}`).join("|");
  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${projectId}/dictionary/parents`)
      .then((r) => (r.ok ? (r.json() as Promise<ParentSuggestions>) : null))
      .then((d) => {
        if (!alive || !d) return;
        setDismissed(readDismissed(projectId));
        setGroups(d.groups ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, dictSig]);

  const parentOf = (e: DictionaryEntry) =>
    Object.prototype.hasOwnProperty.call(parentOverride, e.id)
      ? parentOverride[e.id]
      : e.parent;
  const brands = dict.filter(
    (e) => e.status === "active" && e.canonical !== OTHER_CANONICAL
  );
  const parents = [
    ...new Set(brands.map(parentOf).filter((p): p is string => !!p)),
  ].sort((a, b) => a.localeCompare(b));
  const unparented = brands.filter((b) => !parentOf(b));

  async function post(body: Record<string, unknown>) {
    setSaving(true);
    try {
      await fetch(`/api/projects/${projectId}/dictionary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await onApplied();
    } finally {
      setSaving(false);
    }
  }

  async function setParent(entryId: string, parent: string | null) {
    setParentOverride((prev) => ({ ...prev, [entryId]: parent }));
    try {
      await post({ entryId, action: "set_parent", parent });
    } finally {
      setParentOverride((prev) => {
        const next = { ...prev };
        delete next[entryId];
        return next;
      });
    }
  }

  async function acceptGroups(gs: ParentGroup[]) {
    const actions = gs.flatMap((g) =>
      g.apply.map((entryId) => ({ entryId, action: "set_parent", parent: g.parent }))
    );
    if (actions.length === 0) return;
    const ids = new Set(gs.map((g) => g.key));
    setGroups((prev) => prev.filter((g) => !ids.has(g.key)));
    setParentOverride((prev) => {
      const next = { ...prev };
      for (const g of gs) for (const id of g.apply) next[id] = g.parent;
      return next;
    });
    try {
      for (let i = 0; i < actions.length; i += 300) {
        await post({ actions: actions.slice(i, i + 300) });
      }
    } finally {
      setParentOverride((prev) => {
        const next = { ...prev };
        for (const g of gs) for (const id of g.apply) delete next[id];
        return next;
      });
    }
  }

  function dismiss(key: string) {
    const next = new Set(dismissed);
    next.add(key);
    setDismissed(next);
    writeDismissed(projectId, next);
  }

  const shownGroups = groups.filter((g) => !dismissed.has(g.key));

  function dropProps(parent: string | null | "__new__") {
    return {
      onDragOver: (e: React.DragEvent) => e.preventDefault(),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const entryId = e.dataTransfer.getData("text/brand");
        if (!entryId) return;
        const brand = brands.find((b) => b.id === entryId);
        if (!brand) return;
        const target =
          parent === "__new__"
            ? (brand.display_name ?? brand.canonical)
            : parent;
        if (parentOf(brand) === target) return;
        void setParent(entryId, target);
      },
    };
  }

  function pill(b: DictionaryEntry) {
    return (
      <span
        key={b.id}
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/brand", b.id)}
        className="inline-flex items-center rounded-full border border-line bg-white px-2.5 py-1 text-[13px] font-medium text-ink cursor-grab active:cursor-grabbing select-none"
      >
        {b.display_name ?? b.canonical}
      </span>
    );
  }

  return (
    <div className="grid gap-4">
      {!hideIntro ? (
        <p className="text-[13px] text-ink-3 -mt-1">
          Group brands under their parent company for rollup views. Brand-level
          numbers stay exactly as they are - the parent is an extra layer, and
          dragging a brand out again removes it. Changes save as you go
          {saving ? " - saving…" : "."}
        </p>
      ) : (
        saving && <p className="text-xs text-ink-3 -mt-1">saving…</p>
      )}
      {shownGroups.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              Suggested groups
            </p>
            {shownGroups.length > 1 && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void acceptGroups(shownGroups)}
                className="text-[13px] font-medium text-primary hover:underline disabled:opacity-50"
              >
                Accept all
              </button>
            )}
          </div>
          <p className="text-[13px] text-ink-3 mb-2">
            Brands that look like they share a parent company. Nothing changes
            until you accept a group.
          </p>
          <div className="grid gap-2">
            {shownGroups.map((g) => (
              <div key={g.key} className="card p-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-sm font-semibold text-ink">{g.parent}</span>
                <span className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                  {g.members.map((m) => (
                    <span
                      key={m.id}
                      title={
                        m.self
                          ? "This brand is the company itself"
                          : m.current && m.current !== g.parent
                            ? `Currently under ${m.current}`
                            : undefined
                      }
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[13px] ${
                        m.you ? "border-primary text-primary font-medium" : "border-line text-ink-2"
                      }`}
                    >
                      {m.name}
                      {m.you ? " - your brand" : ""}
                    </span>
                  ))}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void acceptGroups([g])}
                    className="rounded-md bg-primary px-2.5 py-1 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => dismiss(g.key)}
                    className="rounded-md border border-line px-2.5 py-1 text-[13px] font-medium text-ink-2 hover:bg-primary-soft"
                  >
                    Dismiss
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">
          Independent brands ({unparented.length}) - drag into a parent
        </p>
        <div
          className="flex flex-wrap gap-1.5 rounded-lg border border-dashed border-line p-3 min-h-12"
          {...dropProps(null)}
        >
          {unparented.map(pill)}
          {unparented.length === 0 && (
            <span className="text-xs text-ink-3 self-center">
              every brand has a parent - drop one here to make it independent
              again
            </span>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {parents.map((p) => (
          <div key={p} className="card p-4" {...dropProps(p)}>
            <input
              value={labelDrafts[p] ?? p}
              onChange={(e) =>
                setLabelDrafts({ ...labelDrafts, [p]: e.target.value })
              }
              onBlur={() => {
                const next = (labelDrafts[p] ?? p).trim();
                if (next && next !== p) {
                  post({
                    action: "rename_parent",
                    parent: p,
                    displayName: next,
                  });
                }
                setLabelDrafts((d) => {
                  const rest = { ...d };
                  delete rest[p];
                  return rest;
                });
              }}
              className="w-full bg-transparent text-sm font-semibold mb-2 outline-none border-b border-transparent focus:border-line"
              title="Parent company label - rename applies to all its brands"
            />
            <div className="flex flex-wrap gap-1.5 min-h-9">
              {brands.filter((b) => parentOf(b) === p).map(pill)}
            </div>
          </div>
        ))}
        <div
          className="card p-4 border-dashed grid place-items-center text-xs text-ink-3 min-h-20"
          {...dropProps("__new__")}
        >
          drop a brand here to start a new parent company
        </div>
      </div>
    </div>
  );
}
