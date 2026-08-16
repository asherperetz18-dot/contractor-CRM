"use client";

import { useRouter, useSearchParams } from "next/navigation";

const RANGES: { key: string; label: string }[] = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
  { key: "all", label: "All time" },
];

/**
 * Who the report is for, and over what period.
 *
 * Both live in the URL so a report can be linked to and reprinted
 * exactly as it was -- "the one I went through with Simon in August"
 * has to be reproducible months later, or a conversation about it
 * cannot be settled.
 */
export function RepReportFilters({
  reps,
  repId,
  days,
  from,
  to,
}: {
  reps: { id: string; name: string }[];
  repId: string;
  days: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function push(next: URLSearchParams) {
    router.replace(`/marketing-analytics/rep-report?${next.toString()}`);
  }

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    push(next);
  }

  /** Picking a preset drops the custom dates, or the two would fight. */
  function setPreset(key: string) {
    const next = new URLSearchParams(params.toString());
    next.set("days", key);
    next.delete("from");
    next.delete("to");
    push(next);
  }

  /**
   * Month to date, as a starting point to adjust from.
   *
   * A chip that only lights up and cannot be pressed is worse than no
   * chip -- it is the one thing on the row that looks like a button and
   * isn't. Pressing it while a custom range is already set does nothing,
   * so nobody loses the dates they just typed.
   */
  function startCustom() {
    if (from || to) return;
    const today = new Date().toISOString().slice(0, 10);
    const next = new URLSearchParams(params.toString());
    next.set("from", today.slice(0, 8) + "01");
    next.set("to", today);
    next.delete("days");
    push(next);
  }

  /**
   * Typing a date puts the report on the custom range.
   *
   * Seeded with today so a half-filled window does not read as "since
   * the beginning of time" while the other box is still empty.
   */
  function setDate(key: "from" | "to", value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (value && !next.get(key === "from" ? "to" : "from")) {
      next.set(key === "from" ? "to" : "from", new Date().toISOString().slice(0, 10));
    }
    next.delete("days");
    push(next);
  }

  return (
    <div className="stmt-filters">
      <label className="field">
        <span className="field-label">Salesperson</span>
        <select value={repId} onChange={(e) => set("rep", e.target.value)}>
          <option value="">— choose —</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span className="field-label">Period</span>
        <div className="stmt-quick">
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={"chip" + (days === r.key ? " chip-active" : "")}
              onClick={() => setPreset(r.key)}
            >
              {r.label}
            </button>
          ))}
          {/* Active while a custom window is in force, so the chip row
              never looks like nothing is selected. */}
          <button
            className={"chip" + (days === "custom" ? " chip-active" : "")}
            onClick={startCustom}
          >
            Custom
          </button>
        </div>
      </div>
      {/* One field, two inputs: the pair is a single range, and split
          across two wrapped rows the second date reads as an unrelated
          filter. */}
      <div className="field">
        <span className="field-label">Custom range</span>
        <div className="stmt-range">
          <input type="date" value={from} onChange={(e) => setDate("from", e.target.value)} />
          <span className="stmt-range-sep">to</span>
          <input type="date" value={to} onChange={(e) => setDate("to", e.target.value)} />
        </div>
      </div>
    </div>
  );
}
