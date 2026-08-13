import { moneyCents } from "@/lib/data/types";
import { getRepCommissions } from "@/lib/actions/rep-commission";

/**
 * Sales rep commission: half the net profit, after the lead cost and
 * what the job actually spent.
 *
 * Reps see their own lines only, enforced by the action rather than by
 * this page -- a page is a suggestion, an action is the boundary.
 */
export async function RepCommissionTable() {
  const { rows, everyone, error } = await getRepCommissions();
  if (error) return <p className="error-note">{error}</p>;

  const priced = (rows ?? []).filter((r) => !r.detail.unmeasured);
  const pending = (rows ?? []).filter((r) => r.detail.unmeasured);

  const totals = priced.reduce(
    (acc, r) => ({
      earned: acc.earned + r.shareCents,
      payable: acc.payable + r.payableCents,
    }),
    { earned: 0, payable: 0 }
  );

  return (
    <section style={{ marginTop: 28 }}>
      <div className="module-toolbar">
        <div>
          <h2 className="module-title">Sales commission</h2>
          <p className="module-sub">
            A share of what each job actually made &mdash; the contract, less the lead cost, less
            what was spent.
          </p>
        </div>
      </div>

      {!rows?.length ? (
        <div className="empty-state">
          <p className="empty-label">Nothing yet</p>
          <p className="empty-hint">
            Commission appears once a contract is signed and a salesperson is set on it.
          </p>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <div className={"stat-card stat-static" + (totals.earned > 0 ? " stat-card-gold" : "")}>
              <div className="stat-value mono">{moneyCents(totals.earned)}</div>
              <div className="stat-label">Earned</div>
            </div>
            <div className={"stat-card stat-static" + (totals.payable > 0 ? " stat-card-won" : "")}>
              <div className="stat-value mono">{moneyCents(totals.payable)}</div>
              <div className="stat-label">Backed by cash</div>
            </div>
            <div className="stat-card stat-static">
              <div className="stat-value mono">{pending.length}</div>
              <div className="stat-label">Awaiting costs</div>
            </div>
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Job</th>
                  {everyone && <th>Salesperson</th>}
                  <th className="right">Contract</th>
                  <th className="right">Net profit</th>
                  <th className="right">Their share</th>
                  <th className="right">Backed by cash</th>
                </tr>
              </thead>
              <tbody>
                {priced.map((r) => (
                  <tr key={r.estimateId + r.repName}>
                    <td>
                      <div className="ur-name">{r.title || "Untitled job"}</div>
                      <div className="est-tax-note">{r.docNumber}</div>
                    </td>
                    {everyone && <td>{r.repName}</td>}
                    <td className="right mono">{moneyCents(r.detail.contractCents)}</td>
                    <td className="right mono">
                      {moneyCents(r.detail.netProfitCents)}
                      <div className="est-tax-note">
                        less {moneyCents(r.detail.leadCostCents)} lead ·{" "}
                        {moneyCents(r.detail.expensesCents)} spent
                      </div>
                    </td>
                    <td className="right mono">{moneyCents(r.shareCents)}</td>
                    <td className="right mono">
                      {moneyCents(r.payableCents)}
                      <div className="est-tax-note">
                        {(r.collectedPct * 100).toFixed(0)}% collected
                      </div>
                    </td>
                  </tr>
                ))}
                {/* Jobs with no costs recorded are listed but not priced.
                    Net profit on an uncosted job is the whole contract, so
                    a figure here would promise a rep commission on the
                    sale rather than on its margin. */}
                {pending.map((r) => (
                  <tr key={r.estimateId + r.repName} style={{ opacity: 0.65 }}>
                    <td>
                      <div className="ur-name">{r.title || "Untitled job"}</div>
                      <div className="est-tax-note">{r.docNumber}</div>
                    </td>
                    {everyone && <td>{r.repName}</td>}
                    <td className="right mono">{moneyCents(r.detail.contractCents)}</td>
                    <td colSpan={3} className="est-tax-note">
                      Awaiting costs &mdash; nothing has been spent against this job yet, so
                      there is no profit to take a share of.
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="est-tax-note">
        <strong>Earned</strong> is the share of net profit on jobs that have costs recorded.
        <strong> Backed by cash</strong> is the part of it covered by money actually collected, so
        a job signed but unpaid does not read as money in hand.
        {!everyone && " You are seeing your own jobs only."}
      </p>
    </section>
  );
}
