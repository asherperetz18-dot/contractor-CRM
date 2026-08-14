import { Fragment } from "react";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole, moneyCents, COMMISSION_HOLD_LABEL } from "@/lib/data/types";
import { getDispatcherCommissions } from "@/lib/actions/dispatcher";

export const dynamic = "force-dynamic";

/**
 * What dispatchers have earned.
 *
 * Office and Admin see everyone; a dispatcher sees only their own line,
 * which the action enforces rather than this page.
 */
export default async function CommissionsPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const { rows, ratePercent, error } = await getDispatcherCommissions();
  const everyone = isAdminRole(profile);

  const totals = (rows ?? []).reduce(
    (acc, r) => ({
      jobs: acc.jobs + r.jobsSold,
      contract: acc.contract + r.contractCents,
      commission: acc.commission + r.commissionCents,
      payable: acc.payable + r.payableCents,
    }),
    { jobs: 0, contract: 0, commission: 0, payable: 0 }
  );

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Commissions</h1>
          <p className="module-sub">
            {(ratePercent ?? 1).toFixed(2)}% of the gross sale on every signed contract, to the
            dispatcher who brought the lead in.
          </p>
        </div>
        <div className="toolbar-actions">
          <Link href="/commissions/statement" className="btn-ghost">
            Printable statement
          </Link>
        </div>
      </div>

      {error && <p className="error-note">{error}</p>}

      {!rows?.length ? (
        <div className="empty-state">
          <p className="empty-label">Nothing earned yet</p>
          <p className="empty-hint">
            Commission is credited when a contract is signed on a lead a dispatcher holds. Claim a
            lead from the pipeline, and it appears here once that job sells.
          </p>
        </div>
      ) : (
        <>
          <div className="stat-grid stat-grid-5">
            <div className="stat-card stat-static">
              <div className="stat-value mono">{totals.jobs}</div>
              <div className="stat-label">Jobs Sold</div>
            </div>
            <div className="stat-card stat-static">
              <div className="stat-value mono">{moneyCents(totals.contract)}</div>
              <div className="stat-label">Contract Value</div>
            </div>
            <div className={"stat-card stat-static" + (totals.commission > 0 ? " stat-card-gold" : "")}>
              <div className="stat-value mono">{moneyCents(totals.commission)}</div>
              <div className="stat-label">Commission Earned</div>
            </div>
            <div className={"stat-card stat-static" + (totals.payable > 0 ? " stat-card-won" : "")}>
              <div className="stat-value mono">{moneyCents(totals.payable)}</div>
              <div className="stat-label">Payable Now</div>
            </div>
            <div className="stat-card stat-static">
              <div className="stat-value mono">{moneyCents(totals.commission - totals.payable)}</div>
              <div className="stat-label">Held Back</div>
            </div>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Dispatcher</th>
                <th className="right">Jobs sold</th>
                <th className="right">Contract value</th>
                <th className="right">Commission</th>
                <th className="right">Payable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.dispatcherId}>
                  <tr>
                    <td>
                      <div className="ur-name">{r.dispatcherName}</div>
                      {r.dispatcherId === profile.id && (
                        <div className="ur-add-phone">you</div>
                      )}
                    </td>
                    <td className="right mono">{r.jobsSold}</td>
                    <td className="right mono">{moneyCents(r.contractCents)}</td>
                    <td className="right mono">
                      <strong>{moneyCents(r.commissionCents)}</strong>
                    </td>
                    <td className="right mono">
                      {moneyCents(r.payableCents)}
                      {r.payableCents < r.commissionCents && (
                        <div className="ur-add-phone">
                          {moneyCents(r.commissionCents - r.payableCents)} not released yet
                        </div>
                      )}
                    </td>
                  </tr>
                  {/* The contracts behind the total. A commission figure
                      you cannot check is one people argue with, however
                      right it is. */}
                  {r.jobs.map((j) => (
                    <tr key={j.docNumber} className="comm-job">
                      <td>
                        {/* Straight to the contract: the first question
                            after "why is this the number" is "show me the
                            job", and retyping a doc number into search is
                            not an answer. */}
                        <Link className="link-plain" href={`/estimates/${j.estimateId}`}>
                          <span className="mono comm-job-link">{j.docNumber}</span> ·{" "}
                          {j.customerName}
                        </Link>
                      </td>
                      <td></td>
                      <td className="right mono">{moneyCents(j.contractCents)}</td>
                      <td className="right mono">{moneyCents(j.commissionCents)}</td>
                      {/* Nil with no reason reads as "this job earned
                          nothing". What is true is "this is owed once the
                          job is signed off" -- a different sentence, and
                          the only one a dispatcher can act on. */}
                      <td className="right mono">
                        {j.holds.length === 0 ? (
                          moneyCents(j.payableCents)
                        ) : (
                          <>
                            {moneyCents(0)}
                            <div className="ur-add-phone">
                              {j.holds.map((h) => COMMISSION_HOLD_LABEL[h]).join(" · ")}
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* The distinction that decides when it is safe to pay out. */}
      <p className="est-tax-note">
        <strong>Commission</strong> is earned on the gross sale the moment a contract is signed.
        <strong> Payable</strong> is the part of it that has come due: it releases once the job is
        paid in full and the customer has signed the completion certificate — the same two
        conditions the sales reps are paid on.
        {!everyone && " You are seeing your own line only."}
      </p>
    </div>
  );
}
