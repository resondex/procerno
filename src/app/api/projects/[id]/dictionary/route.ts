import { NextResponse } from "next/server";
import { z } from "zod";
import { store } from "@/lib/store";
import { refreshBrandObservations } from "@/lib/engine/observations";
import { requireAuth, requireProject } from "@/lib/auth";
import { matchKey } from "@/lib/brand_key";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) return project;
  const entries = await store.getDictionary(id);
  return NextResponse.json({
    entries,
    version: project.dictionary_version,
  });
}

const actionSchema = z.object({
  entryId: z.string().min(1).optional(),
  action: z.enum([
    "approve",
    "reject",
    "merge",
    "merge_other",
    "rename",
    "unalias",
    "move_alias",
    "promote_alias",
    "confirm",
    "set_parent",
    "rename_parent",
    "set_role",
    "set_analyzed",
  ]),
  mergeIntoId: z.string().min(1).optional(),
  /** Fallback target for merge/move_alias when the target entry was created
   * earlier in the same batch (its id is unknown to the client). */
  mergeIntoName: z.string().trim().min(1).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  alias: z.string().trim().min(1).optional(),
  /** move_alias: where the alias goes — an active entry, Other, or Ignore. */
  to: z.enum(["entry", "other", "ignore"]).optional(),
  /** confirm: names the user has signed off on in the Identify view. */
  names: z.array(z.string().trim().min(1)).max(500).optional(),
  /** set_parent: the parent-company label (null clears). rename_parent: the
   * current label, with displayName carrying the new one. */
  parent: z.string().trim().min(1).max(80).nullable().optional(),
  /** set_role: tracked competitor or model-volunteered discovery. */
  role: z.enum(["competitor", "emerged"]).optional(),
  /** set_analyzed: include/exclude from analysis - matching untouched. */
  analyzed: z.boolean().optional(),
});

const batchSchema = z.object({
  actions: z.array(actionSchema).min(1).max(300),
});

type Action = z.infer<typeof actionSchema>;

/** The catch-all analyzable grouping. Its label is fixed — never renamed. */
const OTHER_CANONICAL = "Other";

function resolveTarget(
  entries: Awaited<ReturnType<typeof store.getDictionary>>,
  a: { mergeIntoId?: string; mergeIntoName?: string }
) {
  if (a.mergeIntoId) return entries.find((e) => e.id === a.mergeIntoId);
  if (!a.mergeIntoName) return undefined;
  const norm = a.mergeIntoName.trim().toLowerCase();
  return entries.find(
    (e) => e.status === "active" && e.canonical.trim().toLowerCase() === norm
  );
}

async function ensureOtherEntry(projectId: string) {
  const entries = await store.getDictionary(projectId);
  const other = entries.find(
    (e) => e.canonical === OTHER_CANONICAL && e.status !== "pending"
  );
  if (other) {
    if (other.status !== "active") {
      await store.upsertDictionaryEntry({
        id: other.id,
        projectId,
        canonical: other.canonical,
        aliases: other.aliases,
        status: "active",
      });
    }
    return other;
  }
  return store.upsertDictionaryEntry({
    id: null,
    projectId,
    canonical: OTHER_CANONICAL,
    aliases: [],
    status: "active",
  });
}

async function applyAction(
  projectId: string,
  a: Action,
  targetBrand?: string
): Promise<string | null> {
  if (a.action === "confirm") {
    if (!a.names || a.names.length === 0) return "confirm needs names";
    await store.confirmDictionaryNames(projectId, a.names);
    return null;
  }

  if (a.action === "rename_parent") {
    if (!a.parent || !a.displayName) {
      return "rename_parent needs parent (old) and displayName (new)";
    }
    await store.renameDictionaryParent(projectId, a.parent, a.displayName);
    return null;
  }

  const entries = await store.getDictionary(projectId);
  const entry = entries.find((e) => e.id === a.entryId);
  if (!entry) return `entry not found: ${a.entryId}`;

  // The target brand's entry is the one row the whole tracker exists to
  // measure - no client action may reject it or merge it away. This guard
  // exists because a UI defect once rejected American Express itself
  // (2026-09-24): whatever the client sends, the server refuses here.
  if (
    targetBrand &&
    (a.action === "reject" ||
      a.action === "merge" ||
      a.action === "merge_other" ||
      (a.action === "set_analyzed" && a.analyzed === false))
  ) {
    const tk = matchKey(targetBrand);
    if (matchKey(entry.canonical) === tk || entry.aliases.some((al) => matchKey(al) === tk)) {
      return `refused: "${entry.canonical}" is the target brand and cannot be ${a.action === "reject" ? "rejected" : a.action === "set_analyzed" ? "excluded from analysis" : "merged away"}`;
    }
  }

  if (a.action === "set_analyzed") {
    if (typeof a.analyzed !== "boolean") return "set_analyzed needs analyzed";
    await store.setDictionaryAnalyzed(entry.id, a.analyzed);
    return null;
  }

  if (a.action === "set_parent") {
    await store.setDictionaryParent(entry.id, a.parent ?? null);
    return null;
  }

  if (a.action === "set_role") {
    if (!a.role) return "set_role needs role";
    await store.setDictionaryRole(entry.id, a.role);
    return null;
  }

  if (a.action === "merge_other") {
    const other = await ensureOtherEntry(projectId);
    if (other.id === entry.id) return null;
    return applyAction(
      projectId,
      { entryId: entry.id, action: "merge", mergeIntoId: other.id },
      targetBrand
    );
  }

  if (a.action === "promote_alias") {
    // An alias becomes its own analyzable brand: detach it, fossilize it as
    // a fresh active entry.
    if (!a.alias) return "promote_alias needs alias";
    const norm = a.alias.trim().toLowerCase();
    if (!entry.aliases.includes(norm)) return `alias not on entry: ${a.alias}`;
    await store.upsertDictionaryEntry({
      id: entry.id,
      projectId,
      canonical: entry.canonical,
      aliases: entry.aliases.filter((x) => x !== norm),
      status: entry.status,
    });
    await store.upsertDictionaryEntry({
      id: null,
      projectId,
      canonical: a.alias.trim(),
      aliases: [],
      status: "active",
      displayName: a.displayName ?? null,
    });
    return null;
  }

  if (a.action === "move_alias") {
    // Atomic re-file of one alias: detach from its entry, land it wherever
    // the user dropped it. The fossilized string itself is never destroyed.
    if (!a.alias) return "move_alias needs alias";
    const norm = a.alias.trim().toLowerCase();
    if (!entry.aliases.includes(norm)) return `alias not on entry: ${a.alias}`;
    await store.upsertDictionaryEntry({
      id: entry.id,
      projectId,
      canonical: entry.canonical,
      aliases: entry.aliases.filter((x) => x !== norm),
      status: entry.status,
    });
    if (a.to === "entry" || a.to === undefined) {
      const into = resolveTarget(entries, a);
      if (!into || into.status !== "active")
        return `move_alias target must be active: ${a.mergeIntoId ?? a.mergeIntoName}`;
      await store.upsertDictionaryEntry({
        id: into.id,
        projectId,
        canonical: into.canonical,
        aliases: [...new Set([...into.aliases, norm])],
        status: "active",
      });
    } else if (a.to === "other") {
      const other = await ensureOtherEntry(projectId);
      await store.upsertDictionaryEntry({
        id: other.id,
        projectId,
        canonical: other.canonical,
        aliases: [...new Set([...other.aliases, norm])],
        status: "active",
      });
    } else {
      // to === "ignore": the name becomes its own rejected entry.
      await store.upsertDictionaryEntry({
        id: null,
        projectId,
        canonical: a.alias.trim(),
        aliases: [],
        status: "rejected",
      });
    }
    return null;
  }

  if (a.action === "approve") {
    await store.upsertDictionaryEntry({
      id: entry.id,
      projectId,
      canonical: entry.canonical,
      aliases: entry.aliases,
      status: "active",
    });
  } else if (a.action === "reject") {
    await store.upsertDictionaryEntry({
      id: entry.id,
      projectId,
      canonical: entry.canonical,
      aliases: entry.aliases,
      status: "rejected",
    });
  } else if (a.action === "rename") {
    // Display-only: the fossilized match strings are never touched.
    if (!a.displayName) return "rename needs displayName";
    await store.upsertDictionaryEntry({
      id: entry.id,
      projectId,
      canonical: entry.canonical,
      aliases: entry.aliases,
      status: entry.status,
      displayName: a.displayName,
    });
  } else if (a.action === "unalias") {
    // Reverse a merge: the alias returns to the queue as its own entry.
    if (!a.alias) return "unalias needs alias";
    const norm = a.alias.trim().toLowerCase();
    if (!entry.aliases.includes(norm)) return `alias not on entry: ${a.alias}`;
    await store.upsertDictionaryEntry({
      id: entry.id,
      projectId,
      canonical: entry.canonical,
      aliases: entry.aliases.filter((x) => x !== norm),
      status: entry.status,
    });
    await store.queueDictionaryCandidates(projectId, [a.alias.trim()]);
  } else {
    const into = resolveTarget(entries, a);
    if (!into || into.status !== "active")
      return `merge target must be active: ${a.mergeIntoId ?? a.mergeIntoName}`;
    await store.upsertDictionaryEntry({
      id: into.id,
      projectId,
      canonical: into.canonical,
      aliases: [
        ...new Set([
          ...into.aliases,
          entry.canonical.trim().toLowerCase(),
          ...entry.aliases,
        ]),
      ],
      status: "active",
    });
    await store.upsertDictionaryEntry({
      id: entry.id,
      projectId,
      canonical: entry.canonical,
      aliases: [],
      status: "rejected",
    });
  }
  return null;
}

/**
 * Review dictionary entries. Accepts a single action or a batch
 * ({actions: [...]}); merges are applied before approves so pending-to-
 * pending merges can target a just-approved entry via ordering by caller.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const project = await requireProject(id, auth, { write: true });
  if (project instanceof NextResponse) return project;
  const body = await req.json().catch(() => null);
  const batch = batchSchema.safeParse(body);
  const single = actionSchema.safeParse(body);
  const actions = batch.success
    ? batch.data.actions
    : single.success
      ? [single.data]
      : null;
  if (!actions) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }
  // Approvals first so same-batch merges can land on newly active entries;
  // the name sign-off ("confirm") last, so it records names where the
  // batch's merges finally put them.
  const ordered = [
    ...actions.filter((a) => a.action !== "merge" && a.action !== "confirm"),
    ...actions.filter((a) => a.action === "merge"),
    ...actions.filter((a) => a.action === "confirm"),
  ];
  const errors: string[] = [];
  for (const a of ordered) {
    const err = await applyAction(id, a, project.brand);
    if (err) errors.push(err);
  }
  const version = await store.bumpDictionaryVersion(id);
  // Entry attribution in the observations follows the dictionary - refresh
  // so tier bars and NOT SEEN flags never go stale after a gate decision.
  // Attribution reads canonical/alias matchKeys and entry status, nothing
  // else - so display-only actions (analyzed toggles, renames, parent
  // groupings, role chips, name sign-offs) skip the recompute and answer
  // fast.
  const ATTRIBUTION_ACTIONS = new Set([
    "approve",
    "reject",
    "merge",
    "merge_other",
    "unalias",
    "move_alias",
    "promote_alias",
  ]);
  if (ordered.some((a) => ATTRIBUTION_ACTIONS.has(a.action))) {
    try {
      await refreshBrandObservations(id);
    } catch (err) {
      console.error("observation refresh failed:", err);
    }
  }
  return NextResponse.json({
    ok: errors.length === 0,
    applied: ordered.length - errors.length,
    errors,
    version,
  });
}
