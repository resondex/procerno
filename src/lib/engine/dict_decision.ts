import { store } from "../store";
import { matchKey } from "../brand_key";
import { ignoreSurfaces } from "../ignore_rules";
import { servedVerdicts, type ServedVerdict } from "./dict_suggest";
import type { DictionaryEntry, Project } from "../types";

/**
 * The brand-dictionary gate's recommended-vs-decided record
 * (projects.dictionary_decision, 2026-10-14) - the dictionary recommender's
 * training data and the direct read for its evals, as taxonomy_decision is
 * for the codebook. Before it, an eval had to rebuild the served board from
 * the verdict cache and replay the co-occurrence guard, and the decided side
 * was whatever the live dictionary held after later edits.
 *
 * One version per gate walk. The SERVED side is captured from the verdict
 * cache the moment the board's layout batch arrives, before it applies (a
 * cache read - never a model call); the DECIDED side is read from the
 * dictionary after the batch and again at the final brands confirm, when
 * parents, renames and analysis toggles are in. A re-walk of a confirmed
 * board opens a new version; earlier versions are never rewritten.
 */

export type ServedShown =
  /** placed as a pill (approve, merge proposal, or a flagged ignore pill) */
  | "pill"
  /** a below-threshold engine ignore folded behind the auto-ignore receipt */
  | "auto_hidden"
  /** an ignore the shared rule surfaces as a review-flagged pill */
  | "surfaced";

export interface DictDecisionName {
  name: string;
  entryId: string;
  /** seed = the target or a setup competitor (never pending, no verdict);
   * engine = the board served a cached verdict; unjudged = pending with no
   * verdict (rendered as an unplaced tray pill); user = an entry the user
   * created (a promoted alias) or one with no verdict on record. */
  origin: "seed" | "engine" | "unjudged" | "user";
  served:
    | (ServedVerdict & {
        /** Answers naming it / observed rows, as the board computed it. */
        share: number;
        shown: ServedShown;
        /** Why a surfaced ignore surfaced (the ignoreSurfaces classes). */
        surfacedBy: "own_context" | "inherited" | "volume" | null;
        /** The board marked it "- review" (a guard-measured merge, a short
         * form, or a surfaced ignore). */
        flagged: boolean;
      })
    | null;
  decided: {
    /** approve = its own active row; merge = an alias of `into`; other =
     * folded into the Other grouping; ignore = rejected; pending = left
     * unreviewed. */
    disposition: "approve" | "merge" | "other" | "ignore" | "pending";
    into: string | null;
    displayName: string | null;
    parent: string | null;
    role: DictionaryEntry["role"];
    analyzed: boolean | null;
  };
  /** Decided matches served (same disposition; same target for merges).
   * Null when nothing was served. */
  agrees: boolean | null;
}

export interface DictDecisionVersion {
  version: number;
  /** When the served side was captured (the first layout batch of the walk,
   * or the final confirm when the walk sent no batch). */
  servedAt: string;
  layoutAt: string | null;
  confirmedAt: string | null;
  /** brand_observations rows the shares were computed over. */
  observedRows: number;
  names: DictDecisionName[];
}

export interface DictDecisionRecord {
  versions: DictDecisionVersion[];
}

const OTHER = "Other";

type ServedMap = Map<string, DictDecisionName["served"]>;

interface Snapshot {
  served: ServedMap;
  origin: Map<string, DictDecisionName["origin"]>;
  ids: Map<string, string>;
  observedRows: number;
}

function parseObservations(json: string | null): {
  rows: number;
  byName: Map<string, number>;
} {
  const byName = new Map<string, number>();
  let rows = 0;
  try {
    const o = json
      ? (JSON.parse(json) as {
          rows: number;
          observed: { name: string; answers: number }[];
        })
      : null;
    rows = o?.rows ?? 0;
    for (const x of o?.observed ?? []) {
      byName.set(x.name.trim().toLowerCase(), x.answers);
    }
  } catch {}
  return { rows, byName };
}

/** The board as served: every entry's cached verdict, its share and how the
 * board showed it - the same ignoreSurfaces rule the board and Analysis
 * settings use. Cache-only. */
export async function snapshotServed(project: Project): Promise<Snapshot> {
  const entries = (await store.getDictionary(project.id)).filter(
    (e) => e.canonical !== OTHER
  );
  const verdicts = await servedVerdicts(
    project.id,
    entries.map((e) => e.canonical)
  );
  const obs = parseObservations(project.brand_observations);
  const seedKeys = new Set(
    [project.brand, ...project.competitors].map((n) => matchKey(n))
  );
  const served: ServedMap = new Map();
  const origin = new Map<string, DictDecisionName["origin"]>();
  const ids = new Map<string, string>();
  for (const e of entries) {
    const k = matchKey(e.canonical);
    ids.set(k, e.id);
    const v = verdicts.get(e.canonical);
    if (!v) {
      served.set(k, null);
      origin.set(
        k,
        seedKeys.has(k) ? "seed" : e.status === "pending" ? "unjudged" : "user"
      );
      continue;
    }
    origin.set(k, "engine");
    const share =
      obs.rows > 0 ? (obs.byName.get(e.canonical.trim().toLowerCase()) ?? 0) / obs.rows : 0;
    let shown: ServedShown = "pill";
    let surfacedBy: "own_context" | "inherited" | "volume" | null = null;
    if (v.action === "ignore") {
      if (ignoreSurfaces(v.rationale, share) === "fold") shown = "auto_hidden";
      else {
        shown = "surfaced";
        surfacedBy = /^own-context brand/.test(v.rationale)
          ? "own_context"
          : /^follows "/.test(v.rationale) && share < 0.1
            ? "inherited"
            : "volume";
      }
    }
    served.set(k, {
      ...v,
      share,
      shown,
      surfacedBy,
      flagged: shown === "surfaced" || /- review\)/.test(v.rationale),
    });
  }
  return { served, origin, ids, observedRows: obs.rows };
}

/** Where each name ended up in the dictionary as it stands now. */
function decidedNames(
  entries: DictionaryEntry[]
): Map<string, { entry: DictionaryEntry; decided: DictDecisionName["decided"] }> {
  const aliasOwner = new Map<string, DictionaryEntry>();
  for (const e of entries) {
    if (e.status !== "active") continue;
    for (const a of e.aliases) aliasOwner.set(matchKey(a), e);
  }
  const out = new Map<
    string,
    { entry: DictionaryEntry; decided: DictDecisionName["decided"] }
  >();
  for (const e of entries) {
    if (e.canonical === OTHER) continue;
    const k = matchKey(e.canonical);
    const base = {
      displayName: e.display_name,
      parent: e.parent,
      role: e.role,
      analyzed: e.status === "active" ? e.analyzed : null,
    };
    if (e.status === "active") {
      out.set(k, { entry: e, decided: { disposition: "approve", into: null, ...base } });
    } else if (e.status === "pending") {
      out.set(k, { entry: e, decided: { disposition: "pending", into: null, ...base } });
    } else {
      const owner = aliasOwner.get(k);
      out.set(k, {
        entry: e,
        decided: owner
          ? owner.canonical === OTHER
            ? { disposition: "other", into: OTHER, ...base }
            : {
                disposition: "merge",
                into: owner.display_name ?? owner.canonical,
                ...base,
                displayName: null,
                parent: null,
                analyzed: null,
              }
          : { disposition: "ignore", into: null, ...base, analyzed: null },
      });
    }
  }
  return out;
}

function agreement(
  served: DictDecisionName["served"],
  decided: DictDecisionName["decided"],
  entries: DictionaryEntry[]
): boolean | null {
  if (!served) return null;
  if (served.action === "approve") return decided.disposition === "approve";
  if (served.action === "ignore") return decided.disposition === "ignore";
  if (decided.disposition !== "merge" || !served.mergeInto) return false;
  // Compare targets by the entry the served name resolves to, so a renamed
  // target still agrees.
  const want = matchKey(served.mergeInto);
  const target = entries.find(
    (e) =>
      e.status === "active" &&
      (matchKey(e.canonical) === want || e.aliases.some((a) => matchKey(a) === want))
  );
  const into = matchKey(decided.into ?? "");
  return target
    ? into === matchKey(target.display_name ?? target.canonical) ||
        into === matchKey(target.canonical)
    : into === want;
}

async function buildNames(
  projectId: string,
  snap: Snapshot
): Promise<DictDecisionName[]> {
  const entries = await store.getDictionary(projectId);
  const decided = decidedNames(entries);
  const keys = [...new Set([...snap.served.keys(), ...decided.keys()])];
  const out: DictDecisionName[] = [];
  for (const k of keys) {
    const d = decided.get(k);
    const served = snap.served.get(k) ?? null;
    if (!d) continue; // an entry that no longer exists (never deleted today)
    out.push({
      name: d.entry.canonical,
      entryId: snap.ids.get(k) ?? d.entry.id,
      origin: snap.origin.get(k) ?? "user",
      served,
      decided: d.decided,
      agrees: agreement(served, d.decided, entries),
    });
  }
  return out;
}

function readRecord(json: string | null): DictDecisionRecord {
  try {
    const r = json ? (JSON.parse(json) as DictDecisionRecord) : null;
    if (r && Array.isArray(r.versions)) return r;
  } catch {}
  return { versions: [] };
}

/** Merge a fresh snapshot into an open version's served side: names already
 * served keep what the board FIRST served them; only names new since then
 * take the fresh read. */
function mergeServed(open: DictDecisionVersion, fresh: Snapshot): Snapshot {
  const served: ServedMap = new Map(fresh.served);
  const origin = new Map(fresh.origin);
  const ids = new Map(fresh.ids);
  for (const n of open.names) {
    const k = matchKey(n.name);
    served.set(k, n.served);
    origin.set(k, n.origin);
    ids.set(k, n.entryId);
  }
  return { served, origin, ids, observedRows: open.observedRows };
}

/** The board's layout batch has applied (it carried the name sign-off):
 * record its served snapshot (taken BEFORE the batch) and the decided side
 * as it now stands. Reuses the walk's open version if one exists. */
export async function recordDictionaryLayout(
  project: Project,
  servedBefore: Snapshot
): Promise<void> {
  const rec = readRecord(await store.getDictionaryDecision(project.id));
  const last = rec.versions.at(-1);
  const now = new Date().toISOString();
  if (last && !last.confirmedAt) {
    const snap = mergeServed(last, servedBefore);
    last.names = await buildNames(project.id, snap);
    last.layoutAt = now;
  } else {
    rec.versions.push({
      version: (last?.version ?? 0) + 1,
      servedAt: now,
      layoutAt: now,
      confirmedAt: null,
      observedRows: servedBefore.observedRows,
      names: await buildNames(project.id, servedBefore),
    });
  }
  await store.setDictionaryDecision(project.id, JSON.stringify(rec));
}

/** The final brands confirm: close the walk's open version with the decided
 * side as confirmed (parents, renames and analysis toggles included). A
 * confirm with no open version (a walk that sent no layout batch) records a
 * new version served from the cache as it stands. */
export async function recordDictionaryConfirm(project: Project): Promise<void> {
  const rec = readRecord(await store.getDictionaryDecision(project.id));
  const last = rec.versions.at(-1);
  const now = new Date().toISOString();
  if (last && !last.confirmedAt) {
    const snap = mergeServed(last, await snapshotServed(project));
    last.names = await buildNames(project.id, snap);
    last.confirmedAt = now;
  } else {
    const snap = await snapshotServed(project);
    rec.versions.push({
      version: (last?.version ?? 0) + 1,
      servedAt: now,
      layoutAt: null,
      confirmedAt: now,
      observedRows: snap.observedRows,
      names: await buildNames(project.id, snap),
    });
  }
  await store.setDictionaryDecision(project.id, JSON.stringify(rec));
}
