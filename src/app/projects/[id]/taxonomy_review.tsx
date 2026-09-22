"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Project } from "@/lib/types";

/**
 * Inline codebook confirmation (the A+ workbench) - the one gating judgment
 * between collection and coding, so it lives on the tracker page itself.
 *
 * Strong-confidence codes arrive included and collapse to a strip; the
 * handful needing judgment get evidence cards. Every action - rename
 * (cosmetic), exclude, merge, add - is undoable via a snapshot stack, and
 * merges can be unmerged individually. Confirm posts the full decision
 * record (recommended vs decided, renames, merges, additions) so the
 * recommender can learn from what humans change.
 */

interface ProposedCode {
  code: string;
  rows: number;
  incidence: number;
  scope: "in" | "boundary";
  recommendation: string;
  why: string;
  evidence_phrases: string[];
}

/** Below this incidence a code needs a human call even when in-scope. */
const REVIEW_FLOOR = 0.06;

interface RowState {
  canonical: string;
  displayName: string;
  included: boolean;
  /** merge-group id (the target canonical) when folded into a merge */
  mergedInto: string | null;
  added: boolean;
}

interface MergeGroup {
  target: string; // canonical of the merged code
  displayName: string;
  members: string[]; // member canonicals
  /** capped-sum incidence shown as an upper bound; the exact row union is
   * recomputed when coding runs. */
  incidenceCap: number;
}

interface ReviewState {
  rows: Record<string, RowState>;
  merges: MergeGroup[];
}

export default function TaxonomyReview({
  id,
  project,
  answers,
  onRatified,
}: {
  id: string;
  project: Project;
  answers: number;
  onRatified: () => void;
}) {
  const proposal = useMemo(() => {
    try {
      return project.taxonomy_proposal
        ? (JSON.parse(project.taxonomy_proposal) as { codes: ProposedCode[] })
        : null;
    } catch {
      return null;
    }
  }, [project.taxonomy_proposal]);
  const codes = useMemo(() => proposal?.codes ?? [], [proposal]);
  const byCode = useMemo(
    () => Object.fromEntries(codes.map((c) => [c.code, c])),
    [codes]
  );
  const strong = codes.filter((c) => c.scope === "in" && c.incidence >= REVIEW_FLOOR);
  const review = codes.filter((c) => c.scope !== "in" || c.incidence < REVIEW_FLOOR);

  const [state, setState] = useState<ReviewState>(() => ({
    rows: Object.fromEntries(
      codes.map((c) => [
        c.code,
        {
          canonical: c.code,
          displayName: c.code,
          // Recommendation applied as the starting point: in-scope included,
          // boundary excluded - flipping it is the review.
          included: c.scope === "in",
          mergedInto: null,
          added: false,
        },
      ])
    ),
    merges: [],
  }));
  const undoStack = useRef<ReviewState[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const [mergeSel, setMergeSel] = useState<Set<string>>(new Set());
  const [addText, setAddText] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback((fn: (s: ReviewState) => ReviewState) => {
    setState((prev) => {
      undoStack.current.push(JSON.parse(JSON.stringify(prev)));
      if (undoStack.current.length > 50) undoStack.current.shift();
      setUndoDepth(undoStack.current.length);
      return fn(prev);
    });
  }, []);

  const undo = () => {
    const prev = undoStack.current.pop();
    if (prev) {
      setState(prev);
      setUndoDepth(undoStack.current.length);
      setMergeSel(new Set());
    }
  };

  const rename = (canonical: string, name: string) =>
    mutate((s) => ({
      ...s,
      rows: {
        ...s.rows,
        [canonical]: { ...s.rows[canonical], displayName: name || canonical },
      },
    }));

  const setIncluded = (canonical: string, included: boolean) =>
    mutate((s) => ({
      ...s,
      rows: { ...s.rows, [canonical]: { ...s.rows[canonical], included } },
    }));

  const doMerge = () => {
    const members = [...mergeSel];
    if (members.length < 2) return;
    // The highest-incidence member's name leads the merged code.
    const lead = members.sort(
      (a, b) => (byCode[b]?.incidence ?? 0) - (byCode[a]?.incidence ?? 0)
    )[0];
    const target = members.join(" + ").slice(0, 76);
    mutate((s) => ({
      rows: Object.fromEntries(
        Object.entries(s.rows).map(([k, r]) => [
          k,
          members.includes(k) ? { ...r, mergedInto: target } : r,
        ])
      ),
      merges: [
        ...s.merges,
        {
          target,
          displayName: s.rows[lead]?.displayName ?? lead,
          members,
          incidenceCap: Math.min(
            1,
            members.reduce((a, m) => a + (byCode[m]?.incidence ?? 0), 0)
          ),
        },
      ],
    }));
    setMergeSel(new Set());
  };

  const unmerge = (target: string) =>
    mutate((s) => ({
      rows: Object.fromEntries(
        Object.entries(s.rows).map(([k, r]) => [
          k,
          r.mergedInto === target ? { ...r, mergedInto: null } : r,
        ])
      ),
      merges: s.merges.filter((m) => m.target !== target),
    }));

  const renameMerge = (target: string, name: string) =>
    mutate((s) => ({
      ...s,
      merges: s.merges.map((m) =>
        m.target === target ? { ...m, displayName: name || m.displayName } : m
      ),
    }));

  const addCode = () => {
    const name = addText.trim().toLowerCase();
    if (!name || state.rows[name]) return;
    mutate((s) => ({
      ...s,
      rows: {
        ...s.rows,
        [name]: {
          canonical: name,
          displayName: name,
          included: true,
          mergedInto: null,
          added: true,
        },
      },
    }));
    setAddText("");
  };

  const includedCount =
    Object.values(state.rows).filter((r) => r.included && !r.mergedInto).length +
    state.merges.length;

  const confirm = async () => {
    setSaving(true);
    setError(null);
    const decisions = Object.values(state.rows).map((r) => {
      const meta = byCode[r.canonical];
      const recommended: "include" | "review" =
        r.added || (meta && meta.scope === "in" && meta.incidence >= REVIEW_FLOOR)
          ? "include"
          : "review";
      return {
        canonical: r.canonical,
        recommended,
        decided: (r.included || r.mergedInto ? "include" : "exclude") as
          | "include"
          | "exclude",
        ...(r.displayName !== r.canonical ? { display_name: r.displayName } : {}),
        ...(r.mergedInto ? { merged_into: r.mergedInto } : {}),
        ...(r.added ? { added: true } : {}),
      };
    });
    const merges = Object.fromEntries(state.merges.map((m) => [m.target, m.members]));
    const res = await fetch(`/api/projects/${id}/taxonomy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions, merges }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(j?.error ?? `save failed (${res.status})`);
      return;
    }
    onRatified();
  };

  if (!proposal) return null;

  const pctBar = (v: number) => (
    <span className="ml-auto flex items-center gap-2">
      <span className="h-1 w-20 overflow-hidden rounded-full bg-line">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${Math.min(100, (v / 0.45) * 100)}%` }}
        />
      </span>
      <span className="w-12 text-right text-xs tabular-nums text-ink-3">
        {(v * 100).toFixed(1)}%
      </span>
    </span>
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-semibold">Confirm your codebook</h3>
          <p className="text-[13px] text-ink-3">
            {codes.length} argument dimensions measured from{" "}
            {answers.toLocaleString()} answers - no list assumed, these are the
            arguments the answers actually make. Click a name to rename it
            (reports use your name; matching stays on ours).
          </p>
        </div>
        <button
          className="text-xs text-ink-3 underline disabled:opacity-40"
          onClick={undo}
          disabled={undoDepth === 0}
        >
          Undo{undoDepth > 0 ? ` (${undoDepth})` : ""}
        </button>
      </div>

      <details className="rounded-lg border border-line" open={mergeSel.size > 0}>
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5 text-[13px]">
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
            {strong.filter((c) => state.rows[c.code]?.included || state.rows[c.code]?.mergedInto).length}{" "}
            strong confidence
          </span>
          <span className="text-ink-3">
            included automatically - open to rename, exclude, or merge
          </span>
        </summary>
        <div className="max-h-80 overflow-y-auto">
          {state.merges.map((m) => (
            <div
              key={m.target}
              className="flex items-center gap-2 border-t border-line bg-primary/5 px-3 py-1.5"
            >
              <input type="checkbox" checked readOnly className="opacity-40" />
              <EditableName
                value={m.displayName}
                onCommit={(v) => renameMerge(m.target, v)}
              />
              <span
                className="rounded-full bg-success/10 px-1.5 py-0.5 text-[11px] font-semibold text-success"
                title={m.members.join(" + ")}
              >
                merged &middot; {m.members.length}
              </span>
              <button
                className="text-[11px] text-ink-3 underline"
                onClick={() => unmerge(m.target)}
              >
                unmerge
              </button>
              <span className="ml-auto text-xs tabular-nums text-ink-3">
                &le; {(m.incidenceCap * 100).toFixed(1)}%
              </span>
            </div>
          ))}
          {strong
            .filter((c) => !state.rows[c.code]?.mergedInto)
            .map((c) => {
              const r = state.rows[c.code];
              return (
                <div key={c.code} className="border-t border-line">
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 ${r.included ? "" : "opacity-50"}`}
                >
                  <input
                    type="checkbox"
                    title="select to merge"
                    checked={mergeSel.has(c.code)}
                    onChange={(e) =>
                      setMergeSel((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(c.code);
                        else n.delete(c.code);
                        return n;
                      })
                    }
                  />
                  <EditableName
                    value={r.displayName}
                    onCommit={(v) => rename(c.code, v)}
                  />
                  {r.displayName !== c.code && (
                    <span className="text-[11px] text-ink-3">({c.code})</span>
                  )}
                  <button
                    className="text-[11px] text-ink-3 underline decoration-dotted"
                    onClick={() => setExpanded(expanded === c.code ? null : c.code)}
                  >
                    {expanded === c.code ? "less" : "details"}
                  </button>
                  {pctBar(c.incidence)}
                  <button
                    className="px-1 text-ink-3"
                    title={r.included ? "exclude" : "re-include"}
                    onClick={() => setIncluded(c.code, !r.included)}
                  >
                    {r.included ? "×" : "+"}
                  </button>
                </div>
                {expanded === c.code && (
                  <div className="grid gap-1 px-9 pb-2">
                    <p className="text-[12.5px] text-ink-3">
                      {c.why} · argued in {c.rows} answers
                    </p>
                    <p className="text-xs italic text-ink-3">
                      {c.evidence_phrases.slice(0, 6).map((ph) => `“${ph}”`).join(" · ")}
                    </p>
                  </div>
                )}
                </div>
              );
            })}
          {[...Object.values(state.rows)]
            .filter((r) => r.added)
            .map((r) => (
              <div key={r.canonical} className="flex items-center gap-2 border-t border-line px-3 py-1.5">
                <input type="checkbox" checked readOnly className="opacity-40" />
                <EditableName value={r.displayName} onCommit={(v) => rename(r.canonical, v)} />
                <span className="rounded-full bg-line px-1.5 py-0.5 text-[11px] text-ink-3">added by you</span>
                <button className="ml-auto px-1 text-ink-3" onClick={() => setIncluded(r.canonical, false)}>
                  {"×"}
                </button>
              </div>
            ))}
        </div>
      </details>

      {mergeSel.size >= 2 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-primary/5 px-3 py-2">
          <span className="text-[13px]">
            Merge {mergeSel.size} into one dimension - it will count every
            answer that argued any of them (recomputed exactly when coding runs).
          </span>
          <div className="flex gap-2">
            <button className="text-xs text-ink-3 underline" onClick={() => setMergeSel(new Set())}>
              Clear
            </button>
            <button
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white"
              onClick={doMerge}
            >
              Merge
            </button>
          </div>
        </div>
      )}

      {review.map((c) => {
        const r = state.rows[c.code];
        if (!r || r.mergedInto) return null;
        return (
          <div
            key={c.code}
            className="grid gap-1.5 rounded-lg border border-line border-l-2 border-l-warning px-3.5 py-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                needs your call
              </span>
              <EditableName value={r.displayName} onCommit={(v) => rename(c.code, v)} />
              <span className="text-xs tabular-nums text-ink-3">
                {(c.incidence * 100).toFixed(1)}% &middot; {c.rows} answers
              </span>
              <span className="ml-auto inline-flex overflow-hidden rounded border border-line text-xs font-medium">
                <button
                  className={`px-2.5 py-1 ${r.included ? "bg-success/10 text-success" : "text-ink-3"}`}
                  onClick={() => setIncluded(c.code, true)}
                >
                  Keep{c.scope === "in" ? " · rec" : ""}
                </button>
                <button
                  className={`px-2.5 py-1 ${!r.included ? "bg-warning/10 text-danger" : "text-ink-3"}`}
                  onClick={() => setIncluded(c.code, false)}
                >
                  Exclude{c.scope === "boundary" ? " · rec" : ""}
                </button>
              </span>
            </div>
            <p className="text-[12.5px] text-ink-3">{c.why}</p>
            <p className="text-xs italic text-ink-3">
              {c.evidence_phrases.slice(0, 5).map((p) => `“${p}”`).join(" · ")}
            </p>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <div className="flex items-center gap-2 text-[13px] text-ink-3">
          <span>Add a dimension we didn&apos;t find:</span>
          <input
            id="tax-add-code"
            className="input w-44 text-[13px]"
            placeholder="e.g. retail availability"
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCode()}
          />
          <button className="text-xs underline" onClick={addCode}>
            add
          </button>
        </div>
        <div className="flex items-center gap-3">
          {error && <span className="text-xs text-danger">{error}</span>}
          <button
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={confirm}
            disabled={saving || includedCount < 3}
          >
            {saving ? "Saving..." : `Confirm ${includedCount} dimensions & start coding`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Explicit rename: the name plus a pencil; clicking either swaps in an
 * input that commits on blur or Enter. Renames are cosmetic - reports use
 * the display name, coding stays on the canonical code. */
function EditableName({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) {
    return (
      <input
        className="input w-40 px-1.5 py-0.5 text-[13px] font-semibold"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const v = draft.trim();
          if (v && v !== value) onCommit(v);
          else setDraft(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLElement).blur();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="group flex items-center gap-1 text-left text-[13.5px] font-semibold"
      title="rename (cosmetic - coding keeps our name)"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      {value}
      <span className="text-[11px] text-ink-3 opacity-0 transition-opacity group-hover:opacity-100">
        {"\u270e"}
      </span>
    </button>
  );
}
