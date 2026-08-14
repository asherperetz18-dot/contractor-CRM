"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * Whose statement, and which pay period.
 *
 * In the URL rather than component state so a statement can be linked to
 * and reprinted exactly as it was -- a question about a payment months
 * later has to be answerable with the same sheet.
 */
export function DispatcherStatementFilters({
  dispatchers,
  dispatcherId,
  from,
  to,
  canChoose,
}: {
  dispatchers: { id: string; name: string }[];
  dispatcherId: string;
  from: string;
  to: string;
  canChoose: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/commissions/statement?${next.toString()}`);
  }

  function setMonth(offset: number) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
    const next = new URLSearchParams(params.toString());
    next.set("from", iso(start));
    next.set("to", iso(end));
    router.replace(`/commissions/statement?${next.toString()}`);
  }

  return (
    <div className="stmt-filters">
      {canChoose && (
        <label className="field">
          <span className="field-label">Dispatcher</span>
          <select value={dispatcherId} onChange={(e) => set("who", e.target.value)}>
            <option value="">Everyone</option>
            {dispatchers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span className="field-label">From</span>
        <input type="date" value={from} onChange={(e) => set("from", e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">To</span>
        <input type="date" value={to} onChange={(e) => set("to", e.target.value)} />
      </label>
      <div className="field">
        <span className="field-label">Period</span>
        <div className="stmt-quick">
          <button className="btn-ghost" onClick={() => setMonth(0)}>
            This month
          </button>
          <button className="btn-ghost" onClick={() => setMonth(-1)}>
            Last month
          </button>
        </div>
      </div>
    </div>
  );
}
