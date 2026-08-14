"use client";

import { useEffect, useRef, useState } from "react";

export type FilterOption = {
  id: string;
  label: string;
  /** Drawn as a swatch beside the label, for calendars. */
  color?: string;
};

/**
 * A collapsed multi-select for one filter group.
 *
 * Shared by the calendar sidebar and the estimates list. The calendar
 * listed every option as a checkbox, which for the rep list meant
 * sixteen rows pushing the dispatcher filter off the bottom of the
 * screen and squeezing the calendar itself.
 *
 * The summary on the button is the whole point of collapsing it: once
 * the options are hidden, the button is the only thing saying what the
 * calendar is currently showing. An empty selection here means "no
 * filter" -- every event is shown -- so it reads "All" rather than
 * "None", which would say the opposite of what the calendar is doing.
 */
export function FilterSelect({
  title,
  options,
  selected,
  onChange,
}: {
  title: string;
  options: FilterOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Closes on a click anywhere else and on Escape. Without this, opening
  // a second filter leaves the first hanging open over the calendar.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = selected.size;
  // None and all-of-them filter identically -- both show everything --
  // so both say so rather than one of them claiming to be a selection.
  const all = count === 0 || count === options.length;
  const summary = all
    ? "All"
    : count === 1
      ? (options.find((o) => selected.has(o.id))?.label ?? "1 selected")
      : `${count} of ${options.length}`;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <div className="cal-filter-select" ref={wrapRef}>
      <button
        type="button"
        className={"cal-filter-btn" + (open ? " cal-filter-btn-open" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="cal-filter-btn-title">{title}</span>
        <span className={"cal-filter-btn-value" + (all ? "" : " cal-filter-btn-active")}>
          {summary}
        </span>
        <span className="cal-filter-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="cal-filter-menu">
          <div className="cal-filter-menu-head">
            <button
              type="button"
              className="cal-select-all"
              onClick={() => onChange(new Set(options.map((o) => o.id)))}
            >
              Select all
            </button>
            <button
              type="button"
              className="cal-select-all"
              onClick={() => onChange(new Set())}
              disabled={count === 0}
            >
              Clear
            </button>
          </div>
          <div className="cal-filter-menu-list">
            {options.map((o) => (
              <label key={o.id} className="cal-filter-item">
                <input
                  type="checkbox"
                  checked={selected.has(o.id)}
                  onChange={() => toggle(o.id)}
                />
                {o.color && <span className="tick" style={{ background: o.color }} />}
                {o.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
