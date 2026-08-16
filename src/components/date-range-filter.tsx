"use client";

import { monthToDate } from "@/lib/data/date-range";

export type RangeState = { preset: string; from: string; to: string };

/**
 * Preset chips plus a custom range, used by every report filter.
 *
 * The presets answer "how are we doing lately". They cannot answer "how
 * did we do in July", which is the question asked in a review -- and a
 * review is what most of these reports exist for.
 *
 * The two halves clear each other. Holding a preset and a pair of dates
 * at once would leave the report showing one period while the controls
 * claimed another, which is worse than either alone.
 */
export function DateRangeFilter({
  presets,
  value,
  onChange,
  min,
  max,
  hint,
  variant = "chips",
}: {
  presets: { key: string; label: string }[];
  value: RangeState;
  onChange: (next: RangeState) => void;
  /** Earliest selectable day, where the page only holds data from then on. */
  min?: string;
  max?: string;
  hint?: string;
  /**
   * Chips or a dropdown. Pages that already filter through a row of
   * selects get a select, so the period control doesn't arrive as the
   * one thing in the toolbar shaped differently from its neighbours.
   */
  variant?: "chips" | "select";
}) {
  const custom = !!(value.from || value.to);

  function setPreset(key: string) {
    onChange({ preset: key, from: "", to: "" });
  }

  /**
   * Month to date, as a starting point to adjust from.
   *
   * A chip that only lights up and cannot be pressed is worse than no
   * chip -- it is the one thing on the row that looks like a button and
   * isn't. Pressing it with a range already set does nothing, so nobody
   * loses the dates they just typed.
   */
  function startCustom() {
    if (custom) return;
    const seed = monthToDate();
    onChange({ preset: value.preset, from: min && seed.from < min ? min : seed.from, to: seed.to });
  }

  /**
   * Typing one edge seeds the other with today, so a half-filled window
   * never quietly means "since the beginning of time".
   */
  function setDate(key: "from" | "to", day: string) {
    const next = { ...value, [key]: day };
    if (day) {
      const other = key === "from" ? "to" : "from";
      if (!next[other]) next[other] = new Date().toISOString().slice(0, 10);
    }
    onChange(next);
  }

  return (
    <div className="range-filter">
      {variant === "select" ? (
        <select
          value={custom ? "custom" : value.preset}
          onChange={(e) => (e.target.value === "custom" ? startCustom() : setPreset(e.target.value))}
        >
          {presets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom range…</option>
        </select>
      ) : (
        <div className="stmt-quick">
          {presets.map((p) => (
            <button
              key={p.key}
              className={"chip" + (!custom && value.preset === p.key ? " chip-active" : "")}
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
          <button className={"chip" + (custom ? " chip-active" : "")} onClick={startCustom}>
            Custom
          </button>
        </div>
      )}
      {custom && (
        <div className="stmt-range">
          <input
            type="date"
            value={value.from}
            min={min}
            max={max}
            onChange={(e) => setDate("from", e.target.value)}
          />
          <span className="stmt-range-sep">to</span>
          <input
            type="date"
            value={value.to}
            min={min}
            max={max}
            onChange={(e) => setDate("to", e.target.value)}
          />
          <button className="btn-ghost small" onClick={() => setPreset(value.preset)}>
            Clear
          </button>
          {hint && <span className="stmt-range-hint">{hint}</span>}
        </div>
      )}
    </div>
  );
}
