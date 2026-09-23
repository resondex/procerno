"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Project } from "@/lib/types";

/**
 * Inline codebook confirmation - the first of two gates between collection
 * and coding (the brand dictionary follows).
 *
 * One row model everywhere: strong-confidence and needs-your-call codes get
 * the same anatomy - merge-select, rename, details, Keep/Exclude - so merging
 * works across buckets. Details expose the micros (the discovered phrases
 * inside a code), each reassignable to another code; moves ship as
 * phrase_moves in the decision record. Every action is undoable via a
 * snapshot stack; merges also unmerge individually. The confirm bar is
 * sticky at the viewport bottom - the page scrolls, the action never leaves.
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

interface Micro {
  p: string;
  n: number;
}

/** Below this incidence a code needs a human call even when in-scope. */
const REVIEW_FLOOR = 0.06;

interface RowState {
  canonical: string;
  displayName: string;
  included: boolean;
  mergedInto: string | null;
  added: boolean;
}

interface MergeGroup {
  target: string;
  displayName: string;
  members: string[];
  incidenceCap: number;
}

interface ReviewState {
  rows: Record<string, RowState>;
  merges: MergeGroup[];
  /** phrase -> code it was moved to */
  moves: Record<string, string>;
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
        ? (JSON.parse(project.taxonomy_proposal) as {
            codes: ProposedCode[];
            micros?: Record<string, Micro[]>;
          })
        : null;
    } catch {
      return null;
    }
  }, [project.taxonomy_proposal]);
  const codes = useMemo(() => proposal?.codes ?? [], [proposal]);
  const micros = useMemo(() => proposal?.micros ?? {}, [proposal]);
  const byCode = useMemo(
    () => Object.fromEntries(codes.map((c) => [c.code, c])),
    [codes]
  );
  // S1 sizing: tier words from within-brand quantiles + a relative bar -
  // exact figures stay stored but unprinted until coding finalizes them.
  const tierOf = useMemo(() => {
    const sorted = [...codes.map((c) => c.incidence)].sort((a, b) => a - b);
    const q = (f: number) => sorted[Math.floor(f * (sorted.length - 1))] ?? 0;
    const [q25, q50, q75] = [q(0.25), q(0.5), q(0.75)];
    const max = sorted[sorted.length - 1] || 1;
    return (v: number) => ({
      label: v >= q75 ? "DOMINANT" : v >= q50 ? "MAJOR" : v >= q25 ? "COMMON" : "OCCASIONAL",
      cls:
        v >= q75
          ? "text-primary"
          : v >= q50
            ? "text-ink"
            : v >= q25
              ? "text-ink-2"
              : "text-ink-3",
      width: Math.max(6, (v / max) * 100),
    });
  }, [codes]);
  const strong = codes.filter((c) => c.scope === "in" && c.incidence >= REVIEW_FLOOR);
  const review = codes.filter((c) => c.scope !== "in" || c.incidence < REVIEW_FLOOR);

  const [state, setState] = useState<ReviewState>(() => ({
    rows: Object.fromEntries(
      codes.map((c) => [
        c.code,
        {
          canonical: c.code,
          displayName: c.code,
          included: c.scope === "in",
          mergedInto: null,
          added: false,
        },
      ])
    ),
    merges: [],
    moves: {},
  }));
  const undoStack = useRef<ReviewState[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const [mergeSel, setMergeSel] = useState<Set<string>>(new Set());
  const [addText, setAddText] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [moveMode, setMoveMode] = useState(false);
  const [moveSel, setMoveSel] = useState<Set<string>>(new Set());
  const [moveDest, setMoveDest] = useState("");
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
    const lead = members.sort(
      (a, b) => (byCode[b]?.incidence ?? 0) - (byCode[a]?.incidence ?? 0)
    )[0];
    const target = members.join(" + ").slice(0, 76);
    mutate((s) => ({
      ...s,
      rows: Object.fromEntries(
        Object.entries(s.rows).map(([k, r]) => [
          k,
          members.includes(k) ? { ...r, mergedInto: target, included: true } : r,
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
      ...s,
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

  const movePhrase = (phrase: string, toCode: string) =>
    mutate((s) => {
      const moves = { ...s.moves };
      // Moving back to its home code clears the move.
      const home = Object.entries(micros).find(([, ms]) =>
        ms.some((m) => m.p === phrase)
      )?.[0];
      if (toCode === home) delete moves[phrase];
      else moves[phrase] = toCode;
      return { ...s, moves };
    });

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

  /** Effective micro list for a code: its own minus moved-out, plus moved-in. */
  const microsFor = useCallback(
    (code: string): Micro[] => {
      const own = (micros[code] ?? []).filter((m) => {
        const moved = state.moves[m.p];
        return !moved || moved === code;
      });
      const movedIn: Micro[] = [];
      for (const [phrase, to] of Object.entries(state.moves)) {
        if (to !== code) continue;
        if (own.some((m) => m.p === phrase)) continue;
        const src = Object.values(micros)
          .flat()
          .find((m) => m.p === phrase);
        movedIn.push(src ?? { p: phrase, n: 0 });
      }
      return [...own, ...movedIn].sort((a, b) => b.n - a.n);
    },
    [micros, state.moves]
  );

  const includedCount =
    Object.values(state.rows).filter((r) => r.included && !r.mergedInto).length +
    state.merges.length;

  const moveTargets = useMemo(
    () =>
      Object.values(state.rows)
        .filter((r) => r.included && !r.mergedInto && !r.added)
        .map((r) => r.canonical)
        .sort(),
    [state.rows]
  );

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
      body: JSON.stringify({ decisions, merges, phrase_moves: state.moves }),
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

  const codeRow = (c: ProposedCode) => {
    const r = state.rows[c.code];
    if (!r || r.mergedInto) return null;
    const isReview = c.scope !== "in" || c.incidence < REVIEW_FLOOR;
    return (
      <div key={c.code} className="border-t border-line first:border-t-0">
        <div
          className={`flex flex-wrap items-center gap-2 px-3 py-2 ${r.included ? "" : "opacity-50"}`}
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
          <EditableName value={r.displayName} onCommit={(v) => rename(c.code, v)} />
          {r.displayName !== c.code && (
            <span className="text-[11px] text-ink-3">({c.code})</span>
          )}
          {isReview && (
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
              needs your call
            </span>
          )}
          <button
            className="text-[11px] text-ink-3 underline decoration-dotted"
            onClick={() => setExpanded(expanded === c.code ? null : c.code)}
          >
            {expanded === c.code ? "less" : "details"}
          </button>
          <span className="ml-auto flex items-center gap-2" title="size is preliminary - final measurement after coding">
            <span className={`w-24 text-right text-[10px] font-bold tracking-wide ${tierOf(c.incidence).cls}`}>
              {tierOf(c.incidence).label}
            </span>
            <span className="h-1 w-20 overflow-hidden rounded-full bg-line">
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${tierOf(c.incidence).width}%` }}
              />
            </span>
          </span>
          <span className="inline-flex overflow-hidden rounded border border-line text-xs font-medium">
            <button
              className={`px-2 py-0.5 ${r.included ? "bg-success/10 text-success" : "text-ink-3"}`}
              onClick={() => setIncluded(c.code, true)}
            >
              Keep{c.scope === "in" && !isReview ? " · rec" : c.scope === "in" ? " · rec" : ""}
            </button>
            <button
              className={`px-2 py-0.5 ${!r.included ? "bg-warning/10 text-danger" : "text-ink-3"}`}
              onClick={() => setIncluded(c.code, false)}
            >
              Exclude{c.scope === "boundary" ? " · rec" : ""}
            </button>
          </span>
        </div>
        {expanded === c.code && (
          <div className="grid gap-2 px-9 pb-3">
            <p className="text-[12.5px] text-ink-3">
              {c.why}{" "}
              <button
                className="text-[11px] underline decoration-dotted"
                onClick={() => {
                  setMoveMode(!moveMode);
                  setMoveSel(new Set());
                }}
              >
                {moveMode ? "done moving" : "move phrases…"}
              </button>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {microsFor(c.code).map((m) => {
                const moved = !!state.moves[m.p];
                const sel = moveSel.has(m.p);
                return (
                  <button
                    key={m.p}
                    type="button"
                    disabled={!moveMode}
                    title={
                      moved
                        ? `moved to ${state.rows[state.moves[m.p]]?.displayName ?? state.moves[m.p]}`
                        : undefined
                    }
                    onClick={() =>
                      setMoveSel((prev) => {
                        const n = new Set(prev);
                        if (n.has(m.p)) n.delete(m.p);
                        else n.add(m.p);
                        return n;
                      })
                    }
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] ${
                      sel
                        ? "border-primary bg-primary/10 text-primary"
                        : moved
                          ? "border-dashed border-primary text-primary"
                          : "border-line text-ink-2"
                    } ${moveMode ? "cursor-pointer" : "cursor-default"}`}
                  >
                    {m.p}
                    <span className="text-[10px] text-ink-3">{m.n}</span>
                  </button>
                );
              })}
            </div>
            {moveMode && (
              <div className="flex flex-wrap items-center gap-2 rounded border border-line bg-primary/5 px-2.5 py-1.5 text-[12px]">
                <span>{moveSel.size} selected</span>
                <select
                  className="input w-auto px-1.5 py-0.5 text-[12px]"
                  value={moveDest}
                  onChange={(e) => setMoveDest(e.target.value)}
                >
                  <option value="">move to&hellip;</option>
                  {moveTargets
                    .filter((t) => t !== c.code)
                    .map((t) => (
                      <option key={t} value={t}>
                        {state.rows[t]?.displayName ?? t}
                      </option>
                    ))}
                </select>
                <button
                  className="rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                  disabled={!moveDest || moveSel.size === 0}
                  onClick={() => {
                    for (const ph of moveSel) movePhrase(ph, moveDest);
                    setMoveSel(new Set());
                    setMoveDest("");
                  }}
                >
                  Move
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-semibold">Confirm your codebook</h3>
          <p className="text-[13px] text-ink-3">
            {codes.length} argument dimensions measured from{" "}
            {answers.toLocaleString()} answers. Rename anything (cosmetic),
            merge by ticking two or more, open details to inspect or move the
            phrases inside a dimension. Sizes are preliminary - final
            measurements appear after coding.
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

      {state.merges.length > 0 && (
        <div className="rounded-lg border border-line">
          {state.merges.map((m) => (
            <div
              key={m.target}
              className="flex flex-wrap items-center gap-2 border-t border-line bg-primary/5 px-3 py-2 first:border-t-0"
            >
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
              <span className="text-[11px] text-ink-3">
                {m.members.join(" + ")}
              </span>
              <button
                className="text-[11px] text-ink-3 underline"
                onClick={() => unmerge(m.target)}
              >
                unmerge
              </button>
              <span
                className="ml-auto text-[10px] font-bold tracking-wide text-primary"
                title="combined size - measured exactly when coding runs"
              >
                COMBINED
              </span>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
            {strong.filter((c) => !state.rows[c.code]?.mergedInto).length} strong
            confidence
          </span>
          <span className="text-xs text-ink-3">included unless you exclude them</span>
        </div>
        <div className="max-h-96 overflow-y-auto rounded-lg border border-line">{strong.map(codeRow)}</div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
            {review.filter((c) => !state.rows[c.code]?.mergedInto).length} need your
            call
          </span>
          <span className="text-xs text-ink-3">
            boundary or rarely argued - the recommendation is pre-applied
          </span>
        </div>
        <div className="max-h-96 overflow-y-auto rounded-lg border border-line">{review.map(codeRow)}</div>
      </div>

      {[...Object.values(state.rows)].filter((r) => r.added).length > 0 && (
        <div className="rounded-lg border border-line">
          {[...Object.values(state.rows)]
            .filter((r) => r.added)
            .map((r) => (
              <div
                key={r.canonical}
                className="flex items-center gap-2 border-t border-line px-3 py-2 first:border-t-0"
              >
                <EditableName value={r.displayName} onCommit={(v) => rename(r.canonical, v)} />
                <span className="rounded-full bg-line px-1.5 py-0.5 text-[11px] text-ink-3">
                  added by you
                </span>
                <button
                  className="ml-auto px-1 text-ink-3"
                  onClick={() => setIncluded(r.canonical, false)}
                >
                  &times;
                </button>
              </div>
            ))}
        </div>
      )}

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

      {/* Sticky action bar: the page scrolls, the decision doesn't leave. */}
      <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-5 py-3">
        {mergeSel.size >= 2 ? (
          <>
            <span className="text-[13px]">
              Merge {mergeSel.size} into one dimension - it counts every answer
              that argued any of them.
            </span>
            <div className="flex gap-2">
              <button
                className="text-xs text-ink-3 underline"
                onClick={() => setMergeSel(new Set())}
              >
                Clear
              </button>
              <button
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white"
                onClick={doMerge}
              >
                Merge
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="text-[13px] text-ink-3">
              {includedCount} dimensions will be tracked
              {Object.keys(state.moves).length > 0 &&
                ` · ${Object.keys(state.moves).length} phrase${Object.keys(state.moves).length === 1 ? "" : "s"} moved`}
            </span>
            <div className="flex items-center gap-3">
              {error && <span className="text-xs text-danger">{error}</span>}
              <button
                className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                onClick={confirm}
                disabled={saving || includedCount < 3}
              >
                {saving
                  ? "Saving..."
                  : `Confirm ${includedCount} dimensions → review brands`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Explicit rename: name + pencil; click swaps in an input. Cosmetic - the
 * canonical code stays the coding key. */
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
        className="input w-44 px-1.5 py-0.5 text-[13px] font-semibold"
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
        &#9998;
      </span>
    </button>
  );
}
