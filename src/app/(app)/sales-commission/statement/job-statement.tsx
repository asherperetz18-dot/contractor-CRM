import Link from "next/link";
import { moneyCents } from "@/lib/data/types";
import type { CommissionPayoutRow, RepCommissionRow } from "@/lib/actions/rep-commission";

function longDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/**
 * One job's commission, start to finish: how the figure is worked out
 * (contract, lead cost, every bill, net profit, the pool, each share),
 * whether it can be paid yet, the customer's payments, and what has
 * already been paid out on it. No pay period -- the job is the unit.
 *
 * rows are this contract's lines, one per salesperson on it (only the
 * viewer's own for a rep). The breakdown is the contract's, so it is
 * read off the first; the shares are per line.
 */
export function JobStatement({
  rows,
  payouts,
  ledgerReady,
}: {
  rows: RepCommissionRow[];
  payouts: CommissionPayoutRow[];
  ledgerReady: boolean;
}) {
  const first = rows[0];
  const d = first.detail;
  const job = first.job;
  const costLines = job?.costLines ?? [];
  const payments = job?.payments ?? [];
  const leadBp = pct(d.leadCostCents, d.contractCents);
  const poolPct = pct(d.poolCents, d.netProfitCents);
  const paidInFull = !first.holds.includes("payment");
  const costsIn = !first.holds.includes("costs");
  const certSigned = !first.holds.includes("certificate");

  return (
    <>
      <div className="estdoc-parties">
        <div>
          <div className="estdoc-label">Job</div>
          <div className="estdoc-strong">{first.customerName}</div>
          <div className="estdoc-muted">
            {first.docNumber}
            {first.title ? ` · ${first.title}` : ""} · signed {longDate(first.signedAt)}
          </div>
        </div>
        <div>
          <div className="estdoc-label">Salesperson</div>
          {rows.map((r) => (
            <div key={r.repId} className="estdoc-strong">
              {r.repName}
              {d.poolCents > 0 && (
                <span className="estdoc-muted"> · {pct(r.shareCents, d.poolCents)}% of pool</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {first.unassignedCosts.count > 0 && (
        <div className="stmt-warning">
          <strong>
            {first.unassignedCosts.count} bill{first.unassignedCosts.count === 1 ? "" : "s"} (
            {moneyCents(first.unassignedCosts.cents)}) on this customer aren&rsquo;t assigned to a
            contract.
          </strong>{" "}
          {first.customerName} has more than one contract, so a bill not assigned to one counts
          toward none of them, and the figures below leave it out.{" "}
          <Link href={`/estimates/${first.estimateId}#job-costs`}>
            Assign them on {first.docNumber} → Job costs
          </Link>{" "}
          or, faster: Projects → this job → 🧾 Bills → &ldquo;Assign all to {first.docNumber}&rdquo;.
        </div>
      )}

      <h2 className="estdoc-terms-head">How the commission is figured</h2>
      <div className="estdoc-totals stmt-breakdown">
        <div className="estdoc-total-row">
          <span>Contract (with signed change orders)</span>
          <span className="mono">{moneyCents(d.contractCents)}</span>
        </div>
        <div className="estdoc-total-row">
          <span>Lead cost ({leadBp}%)</span>
          <span className="mono">&minus;{moneyCents(d.leadCostCents)}</span>
        </div>
        <div className="estdoc-total-row">
          <span>
            Job costs ({costLines.length} bill{costLines.length === 1 ? "" : "s"})
          </span>
          <span className="mono">&minus;{moneyCents(d.expensesCents)}</span>
        </div>
        {costLines.map((c) => (
          <div key={c.id} className="estdoc-total-row stmt-sub">
            <span>
              {c.vendor}
              {c.what ? ` · ${c.what}` : ""} · {longDate(c.spentOn)}
            </span>
            <span className="mono">{moneyCents(c.amountCents)}</span>
          </div>
        ))}
        <div className="estdoc-total-row">
          <span>Net profit</span>
          <span className="mono">{moneyCents(d.netProfitCents)}</span>
        </div>
        <div className="estdoc-total-row">
          <span>Commission pool{d.netProfitCents > 0 ? ` (${poolPct}% of net profit)` : ""}</span>
          <span className="mono">{moneyCents(d.poolCents)}</span>
        </div>
        {d.closerCents > 0 && (
          <div className="estdoc-total-row stmt-sub">
            <span>Closer&rsquo;s cut, off the top</span>
            <span className="mono">{moneyCents(d.closerCents)}</span>
          </div>
        )}
        {rows.map((r) => (
          <div key={r.repId} className="estdoc-total-row estdoc-grand">
            <span>{r.repName}&rsquo;s share</span>
            <span className="mono">{d.unmeasured ? "—" : moneyCents(r.shareCents)}</span>
          </div>
        ))}
      </div>
      {d.unmeasured && (
        <p className="estdoc-muted">
          No bills are counted on this job yet, so there is no share to show: with nothing recorded,
          &ldquo;net profit&rdquo; would be the whole contract.
        </p>
      )}

      <h2 className="estdoc-terms-head">Ready to pay?</h2>
      <ul className="stmt-checks">
        <li className={paidInFull ? "stmt-ok" : "stmt-no"}>
          {paidInFull ? "✓" : "✕"} Paid in full &mdash; {moneyCents(first.collectedCents)} of{" "}
          {moneyCents(d.contractCents)}
        </li>
        <li className={costsIn ? "stmt-ok" : "stmt-no"}>
          {costsIn ? "✓" : "✕"} Job costs recorded
        </li>
        <li className={certSigned ? "stmt-ok" : "stmt-no"}>
          {certSigned ? "✓" : "✕"} Completion certificate signed
          {certSigned && job?.certificateSignedAt ? ` ${longDate(job.certificateSignedAt)}` : ""}
        </li>
      </ul>
      <p className="estdoc-muted">
        {first.holds.length === 0
          ? `Payable since ${longDate(first.qualifiedAt)}.`
          : "Earned, not payable yet — it becomes payable once every box above is ticked."}
      </p>

      <h2 className="estdoc-terms-head">Customer payments</h2>
      {payments.length === 0 ? (
        <p className="estdoc-muted">No payments received yet.</p>
      ) : (
        <table className="estdoc-items estdoc-schedule-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>For</th>
              <th className="estdoc-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p, i) => (
              <tr key={i}>
                <td>{longDate(p.paidAt)}</td>
                <td>
                  {p.kind === "deposit" ? "Deposit" : "Payment"}
                  {p.method ? ` · ${p.method}` : ""}
                </td>
                <td className="estdoc-num">{moneyCents(p.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {ledgerReady && (
        <>
          <h2 className="estdoc-terms-head">Commission paid on this job</h2>
          {payouts.length === 0 ? (
            <p className="estdoc-muted">Nothing paid out against this job yet.</p>
          ) : (
            <table className="estdoc-items estdoc-schedule-table">
              <thead>
                <tr>
                  <th>Date</th>
                  {rows.length > 1 && <th>Salesperson</th>}
                  <th>Type</th>
                  <th className="estdoc-num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {longDate(p.paidOn)}
                      {p.note && <div className="estdoc-muted">{p.note}</div>}
                    </td>
                    {rows.length > 1 && <td>{p.repName}</td>}
                    <td>{p.kind === "advance" ? "Advance" : "Payout"}</td>
                    <td className="estdoc-num">{moneyCents(p.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="estdoc-totals">
            {rows.map((r) => {
              const paid = payouts
                .filter((p) => p.repId === r.repId)
                .reduce((s, p) => s + p.amountCents, 0);
              const left = r.shareCents - paid;
              return (
                <div key={r.repId} className="estdoc-total-row estdoc-grand">
                  <span>
                    {left < 0 ? "Paid ahead on this job" : "Still owed on this job"}
                    {rows.length > 1 ? ` — ${r.repName}` : ""}
                  </span>
                  <span className="mono">{d.unmeasured ? "—" : moneyCents(Math.abs(left))}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
