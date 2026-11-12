"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { WorkbenchView } from "@/lib/engine/workbench";
import { buildSearchIndex, searchIndex, searchSuggestions, type SearchHit } from "./data_search";
import { T } from "./type_scale";

/**
 * The Data page's search box (2026-11-12): a combobox over data_search.ts.
 * Results group by kind (Tables, Brands, Buying situations, ...), each with
 * one line saying what opening it shows. Arrow keys move, Enter opens,
 * Escape closes. Nothing is fetched - the index is built from the payload
 * the page already holds.
 */
export default function DataSearchBox({
  data,
  brand,
  category,
  onOpen,
}: {
  data: WorkbenchView | null;
  brand: string;
  category?: string | null;
  onOpen: (hit: SearchHit) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const index = useMemo(() => buildSearchIndex(data, brand, category), [data, brand, category]);
  const groups = useMemo(() => searchIndex(index, q), [index, q]);
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);
  const suggestions = useMemo(() => searchSuggestions(data), [data]);
  const cur = Math.min(active, Math.max(0, flat.length - 1));

  const choose = (h: SearchHit) => {
    onOpen(h);
    setOpen(false);
    inputRef.current?.blur();
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive(flat.length ? (cur + 1) % flat.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(flat.length ? (cur - 1 + flat.length) % flat.length : 0);
    } else if (e.key === "Enter") {
      if (flat[cur]) {
        e.preventDefault();
        choose(flat[cur]);
      }
    } else if (e.key === "Escape") {
      if (q) setQ("");
      else setOpen(false);
    }
  };

  const showPanel = open;
  let n = -1;
  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showPanel && flat[cur] ? `${listId}-${cur}` : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search a brand, buyer, worry, assistant, or a word like price"
        aria-label="Search the data"
        className={`input w-full py-1.5 ${T.body}`}
      />
      {showPanel && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-lg md:right-auto md:w-[min(560px,90vw)]"
        >
          {!q.trim() ? (
            <div className="grid gap-2 px-2.5 py-2">
              <p className={`${T.sec}`}>
                Search for a brand, a buying situation, a rival, a worry, an assistant, an argument, a number (named, recommended, picked) or a journey stage (awareness,
                consideration, comparison, doubts, value, customers).
              </p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setQ(s);
                      setActive(0);
                      inputRef.current?.focus();
                    }}
                    className={`rounded-full border border-line px-2.5 py-0.5 ${T.cap} text-ink-2 hover:border-ink-3`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : flat.length === 0 ? (
            <div className="grid gap-2 px-2.5 py-2">
              <p className={T.sec}>Nothing matches &ldquo;{q.trim()}&rdquo;. Try one of these:</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setQ(s);
                      setActive(0);
                      inputRef.current?.focus();
                    }}
                    className={`rounded-full border border-line px-2.5 py-0.5 ${T.cap} text-ink-2 hover:border-ink-3`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.kind} className="grid">
                <h5 className={`${T.label} px-2.5 pb-0.5 pt-2`}>{g.title}</h5>
                {g.hits.map((h) => {
                  n++;
                  const i = n;
                  const on = i === cur;
                  return (
                    <button
                      key={h.id}
                      id={`${listId}-${i}`}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(h)}
                      className={`grid rounded-lg px-2.5 py-1.5 text-left ${on ? "bg-primary-soft" : ""}`}
                    >
                      <span className={`${T.body} font-medium text-ink`}>{h.title}</span>
                      <span className={`${T.cap} text-ink-3`}>{h.desc}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
