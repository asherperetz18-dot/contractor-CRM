"use client";

import { useMemo, useState } from "react";
import { DateRangeFilter, type RangeState } from "@/components/date-range-filter";
import { moneyCents } from "@/lib/data/types";
import {
  PL_PERIODS,
  plPeriodWindow,
  profitLoss,
  type PLBasis,
  type PLBill,
  type PLBillPayment,
  type PLContract,
  type PLExpense,
  type PLPayment,
  type PLPeriodKey,
  type PLPhase,
} from "@/lib/data/profit-loss";
import "./profit-loss.css";

export type PLJobInfo = { leadId: string; name: string; address: string | null };

const BASIS_NOTE: Record<PLBasis, string> = {
  cash:
    "Cash counts money that actually moved: customer payments that settled, costs and bill " +
    "payments the day they were paid. A check still clearing is not income yet.",
  accrual:
    "Accrual counts money earned and owed: deposits the day the contract was signed, phases " +
    "the day they were billed, vendor bills the day they arrived — paid or not.",
};

export function ProfitLossView({
  contracts,
  phases,
  payments,
  expenses,
  bills,
  billPayments,
  jobs,
  vendorNames,
}: {
  contracts: PLContract[];
  phases: PLPhase[];
  payments: PLPayment[];
  expenses: PLExpense[];
  bills: PLBill[];
  billPayments: PLBillPayment[];
  jobs: PLJobInfo[];
  vendorNames: { id: string; name: string | null }[];
}) {
  const [basis, setBasis] = useState<PLBasis>("cash");
  const [range, setRange] = useState<RangeState>({ preset: "this-year", from: "", to: "" });

  const jobInfo = useMemo(() => new Map(jobs.map((j) => [j.leadId, j])), [jobs]);
  const vendorName = useMemo(
    () => new Map(vendorNames.map((v) => [v.id, v.name])),
    [vendorNames]
  );

  const window =
    range.from || range.to
      ? { from: range.from || null, to: range.to || null }
      : plPeriodWindow(range.preset as PLPeriodKey);

  const report = useMemo(
    () =>
      profitLoss(basis, window, { contracts, phases, payments, expenses, bills, billPayments }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [basis, window.from, window.to, contracts, phases, payments, expenses, bills, billPayments]
  );

  const pct = (part: number, whole: number) =>
    whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—";
  const money = (cents: number) => (
    <span className={"mono" + (cents < 0 ? " pl-neg" : "")}>{moneyCents(cents)}</span>
  );

  const nothing =
    report.incomeCents === 0 && report.jobCostCents === 0 && report.overheadCents === 0;

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Profit &amp; Loss</h1>
          <p className="module-sub">
            Income, job costs and overhead as one statement — cash or accrual.
          </p>
        </div>
      </div>

      <div className="filter-bar pl-controls">
        <div className="pl-basis" role="tablist" aria-label="Accounting basis">
          <button
            type="button"
            className={"chip" + (basis === "cash" ? " chip-active" : "")}
            onClick={() => setBasis("cash")}
          >
            Cash
          </button>
          <button
            type="button"
            className={"chip" + (basis === "accrual" ? " chip-active" : "")}
            onClick={() => setBasis("accrual")}
          >
            Accrual
          </button>
        </div>
        <DateRangeFilter presets={PL_PERIODS} value={range} onChange={setRange} />
      </div>
      <p className="hint-note pl-basis-note">{BASIS_NOTE[basis]}</p>

      <div className="stat-grid stat-grid-5">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(report.incomeCents)}</div>
          <div className="stat-label">Income</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(report.jobCostCents)}</div>
          <div className="stat-label">Job Costs</div>
        </div>
        <div className="stat-card stat-static">
          <div className={"stat-value mono" + (report.grossProfitCents < 0 ? " pl-neg" : "")}>
            {moneyCents(report.grossProfitCents)}
          </div>
          <div className="stat-label">
            Gross Profit · {pct(report.grossProfitCents, report.incomeCents)}
          </div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(report.overheadCents)}</div>
          <div className="stat-label">Overhead</div>
        </div>
        <div
          className={
            "stat-card stat-static" +
            (report.netProfitCents > 0 ? " stat-card-won" : "") +
            (report.netProfitCents < 0 ? " stat-card-late" : "")
          }
        >
          <div className={"stat-value mono" + (report.netProfitCents < 0 ? " pl-neg" : "")}>
            {moneyCents(report.netProfitCents)}
          </div>
          <div className="stat-label">
            Net Profit · {pct(report.netProfitCents, report.incomeCents)}
          </div>
        </div>
      </div>

      {nothing ? (
        <div className="empty-state">
          <p className="empty-label">Nothing in this period</p>
          <p className="empty-hint">
            No payments, costs or bills fall in this range on the {basis} basis. Try a wider
            period, or the other basis — money billed and money banked land on different days.
          </p>
        </div>
      ) : (
        <>
          <section className="pay-section">
            <h2 className="pay-section-title">By job</h2>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th className="right">Income</th>
                    <th className="right">Job costs</th>
                    <th className="right">Profit</th>
                    <th className="right">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {report.jobs.map((j) => {
                    const info = j.leadId ? jobInfo.get(j.leadId) : null;
                    return (
                      <tr key={j.leadId ?? "~none"}>
                        <td>
                          <span className="ur-name">
                            {j.leadId ? (info?.name ?? "Unnamed job") : "Not tied to a job"}
                          </span>
                          {info?.address && (
                            <div className="est-tax-note">{info.address}</div>
                          )}
                        </td>
                        <td className="right">{money(j.incomeCents)}</td>
                        <td className="right">{money(j.costCents)}</td>
                        <td className="right">{money(j.profitCents)}</td>
                        <td className="right mono">{pct(j.profitCents, j.incomeCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="pl-total-row">
                    <td>Gross profit</td>
                    <td className="right">{money(report.incomeCents)}</td>
                    <td className="right">{money(report.jobCostCents)}</td>
                    <td className="right">{money(report.grossProfitCents)}</td>
                    <td className="right mono">
                      {pct(report.grossProfitCents, report.incomeCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="pay-section">
            <h2 className="pay-section-title">Overhead</h2>
            {report.overhead.length === 0 ? (
              <p className="hint-note">
                No overhead in this period. Overhead is a bill with no job attached — rent,
                insurance, the truck. Enter one from Bills to Pay → Add bills and leave the job
                as “No job — overhead”; it lands here and comes off the profit.
              </p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th className="right">{basis === "cash" ? "Payments" : "Bills"}</th>
                      <th className="right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.overhead.map((o, i) => (
                      <tr key={o.vendorId ?? `n${i}`}>
                        <td>
                          <span className="ur-name">
                            {(o.vendorId ? vendorName.get(o.vendorId) : null) ??
                              o.vendorName ??
                              "—"}
                          </span>
                        </td>
                        <td className="right mono">{o.entries}</td>
                        <td className="right">{money(o.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="pl-total-row">
                      <td>Total overhead</td>
                      <td className="right mono">
                        {report.overhead.reduce((s, o) => s + o.entries, 0)}
                      </td>
                      <td className="right">{money(report.overheadCents)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          <div
            className={
              "pl-net-banner" + (report.netProfitCents < 0 ? " pl-net-banner-loss" : "")
            }
          >
            <span>Net profit</span>
            <span className="pl-net-math mono">
              {moneyCents(report.incomeCents)} − {moneyCents(report.jobCostCents)} −{" "}
              {moneyCents(report.overheadCents)} =
            </span>
            <span className="pl-net-figure mono">{moneyCents(report.netProfitCents)}</span>
          </div>
        </>
      )}
    </div>
  );
}
