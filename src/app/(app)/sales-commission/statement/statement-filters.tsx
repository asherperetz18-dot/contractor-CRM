"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * Who the statement is for, and which pay period -- or which one job.
 *
 * Lives in the URL rather than in component state so a statement can be
 * linked to and reprinted exactly as it was -- "the one I paid Brandon
 * in July" has to be reproducible months later, or a query about a
 * payment cannot be settled.
 */
export function StatementFilters({
  reps,
  repId,
  jobs,
  jobId,
  from,
  to,
  canChooseRep,
}: {
  reps: { id: string; name: string }[];
  repId: string;
  /** This salesperson's contracts, for the one-job statement. */
  jobs: { id: string; label: string }[];
  jobId: string;
  from: string;
  to: string;
  canChooseRep: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/sales-commission/statement?${next.toString()}`);
  }

  function setMonth(offset: number) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`;
    const next = new URLSearchParams(params.toString());
    next.set("from", iso(start));
    next.set("to", iso(end));
    router.replace(`/sales-commission/statement?${next.toString()}`);
  }

  return (
    <div className="stmt-filters">
      {canChooseRep && (
        <label className="field">
          <span className="field-label">Salesperson</span>
          <select
            value={repId}
            onChange={(e) => {
              // Another rep's list won't hold this job; start them fresh.
              const next = new URLSearchParams(params.toString());
              if (e.target.value) next.set("rep", e.target.value);
              else next.delete("rep");
              next.delete("job");
              router.replace(`/sales-commission/statement?${next.toString()}`);
            }}
          >
            <option value="">Everyone</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span className="field-label">Job</span>
        <select value={jobId} onChange={(e) => set("job", e.target.value)}>
          <option value="">All jobs — pay period</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.label}
            </option>
          ))}
        </select>
      </label>
      {/* One job is its whole story, start to finish -- a pay period
          would cut it in half. */}
      {!jobId && (
        <>
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
        </>
      )}
    </div>
  );
}
