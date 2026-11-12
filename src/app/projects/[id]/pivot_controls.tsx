"use client";

import { useId, useRef, useState } from "react";
import { T } from "./type_scale";

/**
 * The Data page's control: a labelled button that opens a list (2026-11-12).
 * Unlike a native select it can show options that do not apply here,
 * greyed, with the reason on hover - so a reader learns why a choice is
 * missing instead of wondering where it went. Each option may carry a one-
 * line hint. Arrow keys move, Enter picks, Escape closes.
 */

export interface ChoiceOption {
  value: string;
  label: string;
  /** A group heading the option sits under. */
  group?: string;
  /** One quiet line under the label. */
  hint?: string;
  /** Why it cannot be picked here (shown on hover); absent = it can. */
  disabled?: string | null;
}

export function Choice({
  label,
  value,
  options,
  onChange,
  tip,
  width = "min-w-[10rem]",
}: {
  label: string;
  value: string;
  options: ChoiceOption[];
  onChange: (v: string) => void;
  /** Explains the control (hover on the label). */
  tip?: string;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const id = useId();
  const btn = useRef<HTMLButtonElement | null>(null);
  const current = options.find((o) => o.value === value);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const openList = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const move = (d: 1 | -1) => {
    if (!enabled.length) return;
    const at = enabled.indexOf(active);
    setActive(enabled[(at + d + enabled.length) % enabled.length] ?? enabled[0]);
  };
  const pick = (o: ChoiceOption) => {
    if (o.disabled) return;
    onChange(o.value);
    setOpen(false);
    btn.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const o = options[active];
      if (o) pick(o);
    } else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
    }
  };
  return (
    <div
      className="relative grid gap-1"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <span className={`${T.label} ${tip ? "cursor-help" : ""}`} title={tip}>
        {label}
      </span>
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKey}
        className={`flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left ${T.ctl} text-ink hover:border-ink-3 ${width}`}
      >
        <span className="truncate">{current?.label ?? "Choose"}</span>
        <span aria-hidden className="text-ink-3">
          ▾
        </span>
      </button>
      {open && (
        <div
          id={id}
          role="listbox"
          tabIndex={-1}
          onKeyDown={onKey}
          className="absolute left-0 top-full z-30 mt-1 max-h-[60vh] w-max min-w-full max-w-[min(26rem,90vw)] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg"
        >
          {options.map((o, i) => {
            const head = o.group && o.group !== options[i - 1]?.group ? o.group : null;
            const on = o.value === value;
            return (
              <div key={o.value}>
                {head && <div className={`${T.label} px-2.5 pb-0.5 pt-2`}>{head}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  aria-disabled={!!o.disabled}
                  title={o.disabled ?? undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => !o.disabled && setActive(i)}
                  onClick={() => pick(o)}
                  className={`grid w-full rounded-lg px-2.5 py-1.5 text-left ${
                    o.disabled ? "cursor-not-allowed text-ink-3/60" : i === active ? "bg-primary-soft text-ink" : "text-ink-2"
                  }`}
                >
                  <span className={`${T.ctl} ${on ? "font-semibold text-ink" : ""}`}>
                    {o.label}
                    {on && <span className="ml-1.5 text-primary">✓</span>}
                  </span>
                  {(o.hint || o.disabled) && <span className={`${T.cap} ${o.disabled ? "text-ink-3/60" : "text-ink-3"}`}>{o.disabled ? `Not here - ${o.disabled}` : o.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A labelled two-to-four way switch (Show as, Waves). */
export function Segments<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: { value: V; label: string; disabled?: string | null }[];
  onChange: (v: V) => void;
}) {
  return (
    <div className="grid gap-1">
      <span className={T.label}>{label}</span>
      <span className="inline-flex w-max rounded-full border border-line bg-surface p-[2px]" role="group" aria-label={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              disabled={!!o.disabled}
              title={o.disabled ?? undefined}
              onClick={() => onChange(o.value)}
              className={`rounded-full px-3 py-1 ${T.cap} ${
                o.disabled ? "cursor-not-allowed text-ink-3/50" : on ? "bg-primary-soft font-semibold text-ink" : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </span>
    </div>
  );
}
