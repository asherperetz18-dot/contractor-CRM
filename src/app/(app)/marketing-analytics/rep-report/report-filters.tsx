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
}: {
  reps: { id: string; name: string }[];
  repId: string;
  days: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/marketing-analytics/rep-report?${next.toString()}`);
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
              onClick={() => set("days", r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
