"use client";

import { useCallback, useEffect, useState } from "react";
import { siteOf } from "@/lib/engine/facts/sources";
import { T } from "./type_scale";

/**
 * The Brand dictionary's Sites tab (2026-11-19): the sites counted as each brand's own when the AI cites a source.
 * Whose a site is comes from what a person entered here, else the saved site check, else the name match (the route
 * says which); a person adds a site to a brand, removes one, or assigns an often cited site nobody owns. Writes are
 * optimistic and revert when the server refuses; a write marks the dictionary dirty (onApplied) so the dashboard's
 * numbers recompute when the dialog closes.
 */

interface SiteRow {
  site: string;
  answers: number;
  from: "entered" | "check" | "name";
}
interface BrandRow {
  id: string;
  name: string;
  you: boolean;
  sites: SiteRow[];
}
interface SitesPayload {
  runId: string | null;
  brands: BrandRow[];
  unclaimed: { site: string; answers: number }[];
}

const FROM_TIP: Record<SiteRow["from"], string> = {
  entered: "Set by your team",
  check: "Found by the site check",
  name: "The site's name matches the brand",
};

export default function SitesTab({ projectId, onApplied }: { projectId: string; onApplied: () => Promise<void> }) {
  const [data, setData] = useState<SitesPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${projectId}/sites`);
      if (!r.ok) throw new Error(String(r.status));
      setData((await r.json()) as SitesPayload);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [projectId]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${projectId}/sites`)
      .then((r) => (r.ok ? (r.json() as Promise<SitesPayload>) : Promise.reject(r.status)))
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [projectId]);

  /** Optimistic edit: apply `next` now, post, then reload the truth (or revert to `prev` on a refusal). */
  async function write(action: "add" | "remove", site: string, brand: string, errorSlot: string, next: SitesPayload) {
    const prev = data;
    setData(next);
    setErrors((e) => ({ ...e, [errorSlot]: "" }));
    setBusy((n) => n + 1);
    try {
      const r = await fetch(`/api/projects/${projectId}/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, site, brand }),
      });
      if (!r.ok) {
        const msg = ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "That change was not saved.";
        setData(prev);
        setErrors((e) => ({ ...e, [errorSlot]: msg }));
        return false;
      }
      await Promise.all([load(), onApplied()]);
      return true;
    } catch {
      setData(prev);
      setErrors((e) => ({ ...e, [errorSlot]: "That change was not saved." }));
      return false;
    } finally {
      setBusy((n) => n - 1);
    }
  }

  function withSite(d: SitesPayload, brand: string, site: string, answers: number): SitesPayload {
    return {
      ...d,
      brands: d.brands.map((b) =>
        b.id === brand && !b.sites.some((s) => s.site === site) ? { ...b, sites: [...b.sites, { site, answers, from: "entered" }] } : b
      ),
      unclaimed: d.unclaimed.filter((u) => u.site !== site),
    };
  }

  async function add(brand: string) {
    if (!data) return;
    const typed = drafts[brand] ?? "";
    const site = siteOf(typed);
    if (!site) {
      setErrors((e) => ({ ...e, [brand]: "That does not read as a web address. Paste a link or type a domain name." }));
      return;
    }
    const ok = await write("add", typed.trim(), brand, brand, withSite(data, brand, site, 0));
    if (ok) setDrafts((d) => ({ ...d, [brand]: "" }));
  }

  function remove(brand: string, site: string) {
    if (!data) return;
    const next: SitesPayload = { ...data, brands: data.brands.map((b) => (b.id === brand ? { ...b, sites: b.sites.filter((s) => s.site !== site) } : b)) };
    void write("remove", site, brand, brand, next);
  }

  function assign(site: string, answers: number, brand: string) {
    if (!data || !brand) return;
    void write("add", site, brand, `u:${site}`, withSite(data, brand, site, answers));
  }

  if (failed && !data) return <p className={T.sec}>The sites could not be loaded. Close the dialog and try again.</p>;
  if (!data) return <p className={T.sec}>Loading the sites...</p>;

  return (
    <div className="grid gap-4 min-w-0">
      <p className={`${T.sec} -mt-1`}>
        These are the sites counted as each brand&apos;s own when the AI cites a source.{busy > 0 ? " Saving..." : ""}
      </p>
      {!data.runId && <p className={T.sec}>No measured wave yet - sites you add here count from the first one.</p>}
      <div className="grid gap-2">
        {data.brands.map((b) => (
          <div key={b.id} className="card p-3 grid gap-2 min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={T.title}>{b.name}</span>
              {b.you && <span className={`${T.cap} text-primary font-medium`}>your brand</span>}
            </div>
            <div className="flex flex-wrap gap-1.5 min-w-0">
              {b.sites.length === 0 && <span className={`${T.cap} text-ink-3 self-center`}>No site yet</span>}
              {b.sites.map((s) => (
                <span
                  key={s.site}
                  title={FROM_TIP[s.from]}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface pl-2.5 pr-1 py-0.5 text-[13px] text-ink"
                >
                  <span className="truncate">{s.site}</span>
                  {s.answers > 0 && (
                    <span className="shrink-0 text-ink-3">
                      {" "}
                      - cited in {s.answers} {s.answers === 1 ? "answer" : "answers"}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${s.site} from ${b.name}`}
                    onClick={() => remove(b.id, s.site)}
                    className="shrink-0 rounded-full px-1.5 text-ink-3 hover:bg-primary-soft hover:text-ink"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <form
              className="flex flex-wrap items-center gap-2 min-w-0"
              onSubmit={(e) => {
                e.preventDefault();
                void add(b.id);
              }}
            >
              <input
                value={drafts[b.id] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [b.id]: e.target.value }))}
                placeholder="Add a site - paste a link or type a domain"
                aria-label={`Add a site for ${b.name}`}
                className="min-w-0 flex-1 basis-56 rounded-md border border-line bg-surface px-2.5 py-1 text-[13px] text-ink placeholder:text-ink-3 outline-none focus:border-ink-3"
              />
              <button type="submit" className={`${T.ctl} rounded-md border border-line px-2.5 py-1 text-ink-2 hover:bg-primary-soft`}>
                Add
              </button>
            </form>
            {errors[b.id] && <p className={`${T.cap} text-danger`}>{errors[b.id]}</p>}
          </div>
        ))}
      </div>
      {data.unclaimed.length > 0 && (
        <div className="grid gap-2 min-w-0">
          <p className={T.label}>Cited often, belonging to no brand in your analysis</p>
          <div className="card divide-y divide-line">
            {data.unclaimed.map((u) => (
              <div key={u.site} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 min-w-0">
                <span className="min-w-0 text-[13px] text-ink">
                  <span className="break-all">{u.site}</span>
                  <span className="text-ink-3">
                    {" "}
                    - cited in {u.answers} {u.answers === 1 ? "answer" : "answers"}
                  </span>
                </span>
                <select
                  value=""
                  onChange={(e) => assign(u.site, u.answers, e.target.value)}
                  aria-label={`Assign ${u.site} to a brand`}
                  className="rounded-md border border-line bg-surface px-2 py-1 text-[13px] text-ink"
                >
                  <option value="">Assign to...</option>
                  {data.brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.you ? " (your brand)" : ""}
                    </option>
                  ))}
                </select>
                {errors[`u:${u.site}`] && <p className={`${T.cap} text-danger w-full`}>{errors[`u:${u.site}`]}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
