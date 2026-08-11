"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  mapsUrl,
  moneyCents,
  projectTriageOrder,
  type ProjectRollup,
} from "@/lib/data/types";

export type ProjectCard = {
  estimateId: string;
  docNumber: string;
  title: string;
  leadId: string;
  customer: string;
  address: string | null;
  repName: string | null;
  signedAt: string | null;
  changeOrderCount: number;
  rollup: ProjectRollup;
};

type Filter = "All" | "Bleeding" | "Owed";

/**
 * Sold jobs, worst first.
 *
 * Sorted by money going the wrong way rather than by name or date:
 * underwater jobs, then the largest amounts owed, then everything else
 * by size. A list ordered any other way is a filing cabinet -- you have
 * to already know which job is in trouble to find out that it is.
 */
export function ProjectsView({ projects }: { projects: ProjectCard[] }) {
  const [filter, setFilter] = useState<Filter>("All");

  const sorted = useMemo(
    () => [...projects].sort((a, b) => projectTriageOrder(a.rollup, b.rollup)),
    [projects]
  );

  const bleeding = sorted.filter((p) => p.rollup.netCashCents < 0);
  const owed = sorted.filter((p) => p.rollup.receivableCents > 0);
  const shown = filter === "Bleeding" ? bleeding : filter === "Owed" ? owed : sorted;

  const totals = projects.reduce(
    (acc, p) => ({
      sold: acc.sold + p.rollup.soldCents,
      collected: acc.collected + p.rollup.collectedCents,
      cost: acc.cost + p.rollup.costCents,
      receivable: acc.receivable + p.rollup.receivableCents,
      net: acc.net + p.rollup.netCashCents,
    }),
    { sold: 0, collected: 0, cost: 0, receivable: 0, net: 0 }
  );

  // Costs nobody can attribute, because the customer has more than one
  // signed contract. Surfaced rather than folded into a job, so the
  // figures above are never quietly wrong.
  //
  // Counted once per customer, not once per project. Every one of a
  // customer's contracts reports the same lead-level figure, so summing
  // the column multiplied it: one $750 receipt on a customer with three
  // contracts was reported as $2,250 of unattributed cost. The totals
  // above were never affected -- they exclude these entirely -- but a
  // warning that overstates the problem is its own kind of wrong.
  const unattributed = [
    ...new Map(
      projects
        .filter((p) => p.rollup.unattributedCostCents)
        .map((p) => [p.leadId, p.rollup.unattributedCostCents])
    ).values(),
  ].reduce((s, v) => s + v, 0);

  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-label">No sold jobs yet</p>
        <p className="empty-hint">
          A project appears here the moment a contract is signed. It gathers that contract,
          its change orders, what has been collected and what the job has cost.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-sub">
            {projects.length} sold job{projects.length === 1 ? "" : "s"} · contract, collected
            and what is left after costs
          </p>
        </div>
      </div>

      <div className="stat-grid stat-grid-5">
        <div className="stat-card">
          <div className="stat-value mono">{moneyCents(totals.sold)}</div>
          <div className="stat-label">Sold</div>
        </div>
        <div className="stat-card">
          <div className="stat-value mono">{moneyCents(totals.collected)}</div>
          <div className="stat-label">Collected</div>
        </div>
        <div className="stat-card">
          <div className="stat-value mono">{moneyCents(totals.receivable)}</div>
          <div className="stat-label">Owed to you</div>
        </div>
        <div className="stat-card">
          <div className="stat-value mono">{moneyCents(totals.cost)}</div>
          <div className="stat-label">Spent</div>
        </div>
        <div className={"stat-card" + (totals.net < 0 ? " digest-urgent" : "")}>
          <div className="stat-value mono">{moneyCents(totals.net)}</div>
          <div className="stat-label">Net cash</div>
        </div>
      </div>

      {bleeding.length > 0 && (
        <div className="dash-panel digest-urgent" style={{ marginBottom: 14 }}>
          <div className="cp-tz-head">
            <span>
              Taking in less than they have cost{" "}
              <span className="count-pill count-pill-urgent">{bleeding.length}</span>
            </span>
          </div>
          <p className="module-sub" style={{ margin: "4px 0 0" }}>
            Collected so far is behind what has been spent. That is normal early on a job and a
            problem late on one &mdash; the phase margins on the contract say which.
          </p>
        </div>
      )}

      {unattributed !== 0 && (
        <p className="hint-note">
          {moneyCents(unattributed)} of costs sit on customers with more than one signed
          contract and are not counted against any single job. File them to a phase on the
          right contract and they will land.
        </p>
      )}

      <div className="chip-row">
        {(["All", "Bleeding", "Owed"] as Filter[]).map((f) => (
          <button
            key={f}
            className={"chip" + (filter === f ? " chip-on" : "")}
            onClick={() => setFilter(f)}
          >
            {f === "All"
              ? `All ${projects.length}`
              : f === "Bleeding"
                ? `Negative net cash ${bleeding.length}`
                : `Owed money ${owed.length}`}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="empty-hint">Nothing here — which is the good outcome.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Customer</th>
                <th className="right">Sold</th>
                <th className="right">Collected</th>
                <th className="right">Owed</th>
                <th className="right">Spent</th>
                <th className="right">Net cash</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.estimateId}>
                  <td>
                    <Link href={`/estimates/${p.estimateId}`} className="ur-name">
                      {p.title || "Untitled job"}
                    </Link>
                    <div className="est-tax-note">
                      {p.docNumber}
                      {p.changeOrderCount > 0 &&
                        ` · ${p.changeOrderCount} change order${p.changeOrderCount === 1 ? "" : "s"}`}
                      {p.repName && ` · ${p.repName}`}
                    </div>
                  </td>
                  <td>
                    {p.customer}
                    {p.address && (
                      <div className="est-tax-note">
                        <a href={mapsUrl(p.address)} target="_blank" rel="noopener noreferrer">
                          {p.address}
                        </a>
                      </div>
                    )}
                  </td>
                  <td className="right mono">{moneyCents(p.rollup.soldCents)}</td>
                  <td className="right mono">
                    {moneyCents(p.rollup.collectedCents)}
                    {p.rollup.collectedPct !== null && (
                      <div className="est-tax-note">
                        {p.rollup.collectedPct.toFixed(0)}% of sold
                      </div>
                    )}
                  </td>
                  <td className="right mono">
                    {p.rollup.receivableCents ? moneyCents(p.rollup.receivableCents) : "—"}
                  </td>
                  <td className="right mono">
                    {p.rollup.costCents ? moneyCents(p.rollup.costCents) : "—"}
                  </td>
                  <td className="right mono">
                    {/* Only coloured once something has actually been spent.
                        A job with no costs recorded is not profitable, it is
                        unmeasured, and green would say otherwise. */}
                    {p.rollup.costCents || p.rollup.collectedCents ? (
                      <span className={p.rollup.netCashCents < 0 ? "stale-tag" : ""}>
                        {moneyCents(p.rollup.netCashCents)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
