"use client";

import { usePathname, useRouter } from "next/navigation";

/**
 * Which days the statement covers (DECISIONS #159). In the address, like
 * the commission statements, so a statement for a period can be linked to
 * and printed again exactly as it was. Not printed.
 */
export function StatementPeriodFilter({
  from,
  to,
  today,
}: {
  from: string | null;
  /** Null is up to today. */
  to: string | null;
  /** The company's YYYY-MM-DD. */
  today: string;
}) {
  const router = useRouter();
  const path = usePathname();

  function go(next: { from: string | null; to: string | null }) {
    const q = new URLSearchParams();
    if (next.from) q.set("from", next.from);
    if (next.to) q.set("to", next.to);
    const query = q.toString();
    router.replace(query ? `${path}?${query}` : path);
  }

  const year = Number(today.slice(0, 4));
  return (
    <div className="stmt-filters">
      <label className="field">
        <span className="field-label">From</span>
        <input
          type="date"
          value={from ?? ""}
          max={today}
          onChange={(e) => go({ from: e.target.value || null, to })}
        />
      </label>
      <label className="field">
        <span className="field-label">To</span>
        <input
          type="date"
          value={to ?? today}
          max={today}
          onChange={(e) => go({ from, to: e.target.value || null })}
        />
      </label>
      <div className="field">
        <span className="field-label">Period</span>
        <div className="stmt-quick">
          <button type="button" className="btn-ghost" onClick={() => go({ from: `${year}-01-01`, to: null })}>
            This year
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => go({ from: `${year - 1}-01-01`, to: `${year - 1}-12-31` })}
          >
            Last year
          </button>
          <button type="button" className="btn-ghost" disabled={!from && !to} onClick={() => go({ from: null, to: null })}>
            All time
          </button>
        </div>
      </div>
    </div>
  );
}
