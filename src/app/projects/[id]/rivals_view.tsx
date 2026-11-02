"use client";

import { useEffect, useMemo, useState } from "react";
import type { HeadlineBrand, HeadlineView } from "@/lib/engine/headline";
import type { ConditionGroup, HeadToHeadRow, HeadToHeadViews } from "@/lib/engine/head_to_head";
import type { CaptureRow } from "@/lib/engine/alternatives";
import type { WorkbenchView } from "@/lib/engine/workbench";
import type { RateCell } from "@/lib/engine/view_data";
import { R } from "@/lib/engine/measures";
import { Tip } from "./table";
import { BaseNote, pct, range } from "./view_parts";

/**
 * Rivals - an Analysis LENS (RATIFIED 2026-11-01, WORKBENCH_REDESIGN_2026-10-30.md
 * top section): the rival ledger. Pick a rival; four two-number pairs (named
 * at all, picked when one is, head to head, their leavers), then the
 * conditions each side wins on and the arguments argued for each.
 *
 * A lens, so partial by design: doubts, value and the customer questions
 * never name a rival and live only under Stations. Composes EXISTING cached
 * views client-side - headline, head_to_head, alternatives, and the wb2 fact
 * table for the per-rival arguments - no engine of its own.
 *
 * Surface rule (2026-11-01): no answer counts on the cards; ranges on hover.
 * Condition lines carry their muted count.
 */

/** Picks under this many answers are muted, never read as confident. */
const THIN = 20;
const TOP_CONDITIONS = 3;
const TOP_ARGUMENTS = 4;

interface OffensiveLite {
  rows: CaptureRow[];
}
interface AlternativesLite {
  offensive: OffensiveLite | null;
}

interface Loaded {
  headline: HeadlineView | null;
  h2h: HeadToHeadViews | null;
  alts: AlternativesLite | null;
  wb: WorkbenchView | null;
}

async function getJson<T>(url: string, field: "view" | "views"): Promise<T | null> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url.split("/").pop()} failed (${r.status})`);
  const d = (await r.json()) as Record<string, T | null>;
  return d[field] ?? null;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Wilson 95% interval - the same math as engine/metrics.ts wilson(). */
function cellOf(k: number, n: number): RateCell {
  if (n === 0) return { k, n, low: 0, high: 0 };
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / d;
  const m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { k, n, low: Math.max(0, center - m), high: Math.min(1, center + m) };
}

interface Rival {
  id: string;
  key: string;
  name: string;
  kind: "entity" | "class";
  brand: HeadlineBrand | null;
  h2h: HeadToHeadRow | null;
  leavers: CaptureRow | null;
}

/** Every rival the lens can be read against: entity head-to-head rivals and
 * the headline's competitors (head-to-head first, then by share of decided),
 * then class rivals as dim pills. A brand that is a class rival is listed
 * only as its class. */
function rivalsOf(d: Loaded): Rival[] {
  const target = d.headline?.brands.find((b) => b.role === "target") ?? null;
  const brands = (d.headline?.brands ?? []).filter((b) => b.role !== "target");
  const byKey = new Map(brands.map((b) => [b.key, b]));
  const byName = new Map(brands.map((b) => [norm(b.name), b]));
  const leavers = new Map((d.alts?.offensive?.rows ?? []).map((r) => [r.key, r]));
  const classRows = (d.h2h?.class?.rows ?? []).filter((r) => r.key !== target?.key);
  const classKeys = new Set(classRows.map((r) => r.key));
  const entityRows = d.h2h?.entity?.rows ?? [];

  const out = new Map<string, Rival>();
  for (const r of entityRows) {
    if (classKeys.has(r.key) || r.key === target?.key) continue;
    const b = byKey.get(r.key) ?? byName.get(norm(r.rival)) ?? null;
    out.set(r.key, { id: `e:${r.key}`, key: r.key, name: b?.name ?? r.rival, kind: "entity", brand: b, h2h: r, leavers: leavers.get(r.key) ?? null });
  }
  for (const b of brands) {
    if (b.role !== "competitor" || out.has(b.key) || classKeys.has(b.key)) continue;
    out.set(b.key, { id: `e:${b.key}`, key: b.key, name: b.name, kind: "entity", brand: b, h2h: null, leavers: leavers.get(b.key) ?? null });
  }
  const sod = (r: Rival) => (r.brand && r.brand.shareOfDecided.n > 0 ? r.brand.shareOfDecided.k / r.brand.shareOfDecided.n : -1);
  const entity = [...out.values()].sort((a, b) => Number(!!b.h2h) - Number(!!a.h2h) || sod(b) - sod(a));
  const classes: Rival[] = classRows.map((r) => {
    const b = byKey.get(r.key) ?? byName.get(norm(r.rival)) ?? null;
    return { id: `c:${r.key}`, key: r.key, name: b?.name ?? r.rival, kind: "class", brand: b, h2h: r, leavers: null };
  });
  return [...entity, ...classes];
}

/** Per pick: how many headline answers picked each brand, and how many of
 * those argue each code (wb2 facts, one row per answer). */
interface PickArgs {
  n: number;
  args: Map<number, number>;
}
function pickArguments(wb: WorkbenchView): Map<number, PickArgs> {
  const out = new Map<number, PickArgs>();
  for (const f of wb.facts) {
    const prompt = wb.prompts[f[R.prompt]];
    if (!prompt || !prompt.views.includes("headline")) continue;
    const pick = f[R.pick];
    if (pick < 0) continue;
    let acc = out.get(pick);
    if (!acc) out.set(pick, (acc = { n: 0, args: new Map() }));
    acc.n++;
    for (const a of f[R.args]) acc.args.set(a, (acc.args.get(a) ?? 0) + 1);
  }
  return out;
}

interface ArgLine {
  code: string;
  you: RateCell;
  them: RateCell;
  diff: number;
}

function argLines(wb: WorkbenchView, picks: Map<number, PickArgs>, rivalName: string): { you: ArgLine[]; them: ArgLine[]; thin: boolean } | null {
  const ri = wb.brands.findIndex((b) => norm(b.name) === norm(rivalName));
  const mine = picks.get(wb.target);
  const theirs = ri >= 0 ? picks.get(ri) : undefined;
  if (!mine || !theirs) return null;
  const codes = new Set([...mine.args.keys(), ...theirs.args.keys()]);
  const lines: ArgLine[] = [...codes].map((c) => {
    const you = cellOf(mine.args.get(c) ?? 0, mine.n);
    const them = cellOf(theirs.args.get(c) ?? 0, theirs.n);
    return { code: wb.args[c], you, them, diff: you.k / you.n - them.k / them.n };
  });
  return {
    you: lines.filter((l) => l.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, TOP_ARGUMENTS),
    them: lines.filter((l) => l.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, TOP_ARGUMENTS),
    thin: mine.n < THIN || theirs.n < THIN,
  };
}

function Pct({ c, label, className = "" }: { c: RateCell; label: string; className?: string }) {
  const thin = c.n > 0 && c.n < THIN;
  return (
    <Tip tip={`${label}: ${range(c)}${thin ? ` - too few answers to read (${c.n})` : ""}`}>
      <span className={`cursor-help tabular-nums ${thin ? "opacity-60" : ""} ${className}`}>{pct(c)}</span>
    </Tip>
  );
}

function PairCard({
  label,
  you,
  them,
  youLabel,
  themLabel,
  themWord,
  anchor,
  empty,
}: {
  label: string;
  you?: RateCell | null;
  them?: RateCell | null;
  youLabel: string;
  themLabel: string;
  themWord?: string;
  anchor?: React.ReactNode;
  empty?: string;
}) {
  return (
    <div className="card p-3.5 grid gap-1.5 content-start">
      <span className="section-label">{label}</span>
      {you ? (
        <div className="flex items-baseline gap-1.5">
          <Pct c={you} label={youLabel} className="text-[1.6rem] leading-tight font-semibold" />
          {themWord ? (
            <span className="text-[14px] text-ink-3">{themWord}</span>
          ) : (
            <span className="text-[14px] text-ink-3">
              vs {them ? <Pct c={them} label={themLabel} /> : "-"}
            </span>
          )}
        </div>
      ) : (
        <div className="text-[12px] text-ink-3">{empty}</div>
      )}
      {you && anchor && <span className="text-[12px] leading-snug text-ink-2">{anchor}</span>}
    </div>
  );
}

function ConditionLines({ title, groups }: { title: string; groups: ConditionGroup[] }) {
  return (
    <div>
      <div className="text-[13px] font-medium text-ink mb-2">{title}</div>
      {groups.length === 0 ? (
        <p className="text-[12px] text-ink-3">No conditions stated here.</p>
      ) : (
        <ul className="grid gap-1.5">
          {groups.slice(0, TOP_CONDITIONS).map((g) => (
            <li key={g.label} className="text-[13px] text-ink-2">
              {g.label} <span className="text-[11px] text-ink-3 tabular-nums">{g.n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ArgList({ title, lines, you, them }: { title: string; lines: ArgLine[]; you: string; them: string }) {
  return (
    <div>
      <div className="text-[13px] font-medium text-ink mb-2">{title}</div>
      {lines.length === 0 ? (
        <p className="text-[12px] text-ink-3">No argument leans this way.</p>
      ) : (
        <ul className="grid gap-1.5">
          {lines.map((l) => (
            <li key={l.code} className="text-[13px] text-ink-2">
              <span className="text-ink">{l.code}</span>
              <span className="text-ink-3">
                {" - "}
                <Pct c={l.you} label={`Answers picking ${you} that argue it`} /> vs{" "}
                <Pct c={l.them} label={`Answers picking ${them} that argue it`} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function RivalsSection({ runId }: { runId: string }) {
  const [data, setData] = useState<Loaded | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const base = `/api/runs/${runId}`;
    const soft = <T,>(p: Promise<T | null>) => p.catch(() => null);
    Promise.all([
      soft(getJson<HeadlineView>(`${base}/headline`, "view")),
      soft(getJson<HeadToHeadViews>(`${base}/head_to_head`, "views")),
      soft(getJson<AlternativesLite>(`${base}/alternatives`, "views")),
      soft(getJson<WorkbenchView>(`${base}/workbench`, "view")),
    ])
      .then(([headline, h2h, alts, wb]) => live && setData({ headline, h2h, alts, wb }))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId]);

  const rivals = useMemo(() => (data ? rivalsOf(data) : []), [data]);
  const picks = useMemo(() => (data?.wb ? pickArguments(data.wb) : null), [data]);

  if (error) return <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>;
  if (data === undefined) return <div className="card px-5 py-4 text-[13px] text-ink-3">Loading rivals...</div>;
  if (rivals.length === 0) return null;

  // Derived default: the first pill until the user picks one.
  const sel = rivals.find((r) => r.id === picked) ?? rivals[0];
  const you = data.headline?.brand ?? data.wb?.brand ?? "You";
  const target = data.headline?.brands.find((b) => b.role === "target") ?? null;
  const args = data.wb && picks ? argLines(data.wb, picks, sel.name) : null;
  const h = sel.h2h;
  const cond = h?.conditions;

  return (
    <div className="grid gap-5">
      <section className="card p-6 grid gap-3">
        <div>
          <h2 className="section-label mb-1">Rivals</h2>
          <h3 className="text-[15px] font-semibold">You against each rival</h3>
          <p className="text-[13px] text-ink-3 mt-1">
            Pick a rival to see where you stand with them across every question that puts you side by side.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-ink-3 mr-1">Against:</span>
          {rivals.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setPicked(r.id)}
              aria-pressed={sel.id === r.id}
              className={`rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ${
                sel.id === r.id
                  ? "border-[var(--color-primary)] bg-primary-soft text-primary"
                  : r.kind === "class"
                    ? "border-line text-ink-3 hover:border-ink-3"
                    : "border-line text-ink-2 hover:border-ink-3"
              }`}
            >
              {r.kind === "class" ? (
                <Tip tip={`A kind of product rather than one brand - questions that set you against any ${r.name} product.`}>
                  <span>{r.name} (class)</span>
                </Tip>
              ) : (
                r.name
              )}
            </button>
          ))}
        </div>
      </section>

      <div className={`grid grid-cols-2 gap-3 ${sel.kind === "class" ? "md:grid-cols-3" : "md:grid-cols-4"}`}>
        <PairCard
          label="Named at all"
          you={target?.mentioned ?? null}
          them={sel.brand?.mentioned ?? null}
          youLabel={`${you} named`}
          themLabel={`${sel.name} named`}
          anchor={
            <Tip tip="Answers to which-should-I-get questions that name the brand at all.">
              <span className="cursor-help">in &ldquo;which should I get&rdquo; answers</span>
            </Tip>
          }
          empty="Not asked"
        />
        <PairCard
          label="Picked, when one is"
          you={target?.shareOfDecided ?? null}
          them={sel.brand?.shareOfDecided ?? null}
          youLabel={`${you} picked, when one brand is`}
          themLabel={`${sel.name} picked, when one brand is`}
          anchor={
            <Tip tip="Of the which-should-I-get answers that pick one brand in your category (share of decided).">
              <span className="cursor-help">when the answer picks one brand</span>
            </Tip>
          }
          empty="Not asked"
        />
        <PairCard
          label="Head to head"
          you={h?.won ?? null}
          them={h?.lost ?? null}
          youLabel={`You win vs ${sel.name}`}
          themLabel={`${sel.name} wins`}
          anchor={
            h && (
              <>
                <Pct c={h.undecided} label="No single pick" /> no single pick
              </>
            )
          }
          empty="Not asked head to head"
        />
        {sel.kind === "entity" && (
          <PairCard
            label="Their leavers"
            you={sel.leavers?.captured ?? null}
            youLabel={`${sel.name}'s leavers told to pick you`}
            themLabel=""
            themWord="pick you"
            anchor={
              sel.leavers && (
                <>
                  named in <Pct c={sel.leavers.named} label="Leavers' answers naming you" /> of their leavers&apos; answers
                </>
              )
            }
            empty="No leaver questions for this rival"
          />
        )}
      </div>

      {(cond || args) && (
        <section className="card p-6 grid gap-6">
          {cond && (
            <div className="grid md:grid-cols-2 gap-5">
              <ConditionLines title={`You beat ${sel.name} when the buyer`} groups={cond.you} />
              <ConditionLines title={`${sel.name} beats you when the buyer`} groups={cond.rival} />
            </div>
          )}
          {args && (
            <div className={`grid md:grid-cols-2 gap-5 ${args.thin ? "opacity-70" : ""}`}>
              <ArgList title="Argued for you" lines={args.you} you={you} them={sel.name} />
              <ArgList title={`Argued for ${sel.name}`} lines={args.them} you={you} them={sel.name} />
            </div>
          )}
          {cond && (
            <p className="text-[11px] text-ink-3">
              The small number is how many answers state the condition in head-to-head questions. Arguments compare the
              which-should-I-get answers that pick you with those that pick {sel.name}
              {args?.thin ? " - too few picks to read as more than direction" : ""}.
            </p>
          )}
        </section>
      )}

      <div className="grid gap-1">
        <p className="text-[12px] text-ink-3">
          Doubts, value and your customers&apos; worries never name a rival; they live under Stations.
        </p>
        <BaseNote>Based on the questions that name or pick a rival, across all buyers.</BaseNote>
      </div>
    </div>
  );
}
