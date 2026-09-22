import Link from "next/link";
import { moneyCents, COMMISSION_HOLD_LABEL } from "@/lib/data/types";
import {
  getRepCommissions,
  getCommissionPayouts,
  getCommissionReps,
  type CommissionRep,
} from "@/lib/actions/rep-commission";
import {
  repBalances,
  balanceTotals,
  type CommissionLineLike,
  type PayoutLike,
} from "@/lib/data/commission-payouts";
import { commissionRepFilterOptions } from "@/lib/data/commission-filter-options";
import { PayoutsPanel, type PayoutJobOption } from "./payouts-panel";
import { RepFilter } from "./rep-filter";

/**
 * Sales rep commission: a share of the net profit, after the lead cost
 * and what the job actually spent, paid once the job is finished and
 * settled.
 *
 * Reps see their own lines only, enforced by the action rather than
 * this page -- a page is a suggestion, an action is the boundary.
 *
 * Beside what each job EARNS, the page shows what has actually been
 * PAID (the payout ledger, 0158) and therefore what is still DUE per
 * salesperson -- without a record of payment, a qualified commission
 * read as "payable" forever, and an advance had no home at all. Until
 * that migration is run the ledger reports itself not ready and this
 * page renders exactly as it did before.
 */
export async function RepCommissionTable({ repFilter = "" }: { repFilter?: string }) {
  const [{ rows: allRows, everyone, error }, payoutsRes] = await Promise.all([
    getRepCommissions(),
    getCommissionPayouts(),
  ]);
  if (error) return <p className="error-note">{error}</p>;

  const ledgerReady = payoutsRes.ledgerReady === true;
  const canRecord = payoutsRes.canRecord === true && ledgerReady;
  const allPayouts = payoutsRes.payouts ?? [];
  // The roster feeds the filter's options as well as the payout modal,
  // so it is fetched for anyone who sees everyone's lines.
  const reps: CommissionRep[] = everyone ? await getCommissionReps() : [];

  // The filter is an admin's tool -- a rep already sees only their own
  // lines. Options are built from the UNFILTERED rows (standing rule:
  // the Sales roster plus everyone present in the rows plus the tick),
  // then every figure on the page narrows to the picked person: stat
  // cards, balance table, jobs and the payout ledger all describe the
  // same one salesperson's money, never a mix.
  const filtering = !!repFilter && !!everyone;
  const filterOptions = everyone
    ? commissionRepFilterOptions(reps, allRows ?? [], repFilter)
    : [];
  const rows = filtering ? (allRows ?? []).filter((r) => r.repId === repFilter) : (allRows ?? []);
  const payouts = filtering ? allPayouts.filter((p) => p.repId === repFilter) : allPayouts;

  const priced = rows.filter((r) => !r.detail.unmeasured);
  const pending = rows.filter((r) => r.detail.unmeasured);

  const lines: CommissionLineLike[] = rows.map((r) => ({
    repId: r.repId,
    shareCents: r.shareCents,
    payable: r.holds.length === 0,
    qualifiedAt: r.qualifiedAt,
    unmeasured: r.detail.unmeasured,
  }));
  const payoutLikes: PayoutLike[] = payouts.map((p) => ({
    repId: p.repId,
    amountCents: p.amountCents,
    paidOn: p.paidOn,
    kind: p.kind,
  }));
  const balances = repBalances(lines, payoutLikes);
  const totals = balanceTotals(balances.values());

  // Names for the per-rep summary: whatever named the rows and the
  // ledger, so an archived rep with money outstanding keeps their name.
  const repNameById = new Map<string, string>();
  for (const r of rows) repNameById.set(r.repId, r.repName);
  for (const p of payouts) repNameById.set(p.repId, p.repName);
  const balanceRows = [...balances.values()].sort((a, b) =>
    (repNameById.get(a.repId) ?? "").localeCompare(repNameById.get(b.repId) ?? "")
  );

  // What has been paid against each job line, for the note on its row.
  const paidByJobRep = new Map<string, number>();
  for (const p of payouts) {
    if (!p.estimateId) continue;
    const key = p.estimateId + p.repId;
    paidByJobRep.set(key, (paidByJobRep.get(key) ?? 0) + p.amountCents);
  }

  // The modal's job picker: this rep's contracts, held ones flagged so
  // money against them defaults to an advance.
  const jobsByRep: Record<string, PayoutJobOption[]> = {};
  for (const r of rows) {
    (jobsByRep[r.repId] ??= []).push({
      estimateId: r.estimateId,
      label: `${r.customerName} — ${r.docNumber}${r.title ? ` · ${r.title}` : ""}`,
      held: r.holds.length > 0,
    });
  }

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
        <div className="toolbar-actions">
          {everyone && filterOptions.length > 0 && (
            <RepFilter options={filterOptions} value={repFilter} />
          )}
          <Link href="/sales-commission/statement" className="btn-ghost">
            Printable statement
          </Link>
        </div>
      </div>

      {!rows.length ? (
        <div className="empty-state">
          <p className="empty-label">
            {filtering ? "Nothing for this salesperson" : "Nothing yet"}
          </p>
          <p className="empty-hint">
            {filtering ? (
              <>They have no signed contracts with a commission seat — pick Everyone to see the full report.</>
            ) : (
              <>Commission appears once a contract is signed and a salesperson is set on it.</>
            )}
          </p>
        </div>
      ) : (
        <>
          <div className={"stat-grid" + (ledgerReady ? " stat-grid-5" : "")}>
            <div className={"stat-card stat-static" + (totals.earnedCents > 0 ? " stat-card-gold" : "")}>
              <div className="stat-value mono">{moneyCents(totals.earnedCents)}</div>
              <div className="stat-label">Earned</div>
            </div>
            <div className={"stat-card stat-static" + (totals.payableCents > 0 ? " stat-card-won" : "")}>
              <div className="stat-value mono">{moneyCents(totals.payableCents)}</div>
              <div className="stat-label">Payable now</div>
            </div>
            {ledgerReady && (
              <>
                <div className="stat-card stat-static">
                  <div className="stat-value mono">{moneyCents(totals.paidCents)}</div>
                  <div className="stat-label">Paid out</div>
                  {totals.advanceCents > 0 && (
                    <div className="est-tax-note">
                      incl. {moneyCents(totals.advanceCents)} advances
                    </div>
                  )}
                </div>
                <div className={"stat-card stat-static" + (totals.dueCents > 0 ? " stat-card-won" : "")}>
                  <div className="stat-value mono">{moneyCents(totals.dueCents)}</div>
                  <div className="stat-label">Balance due</div>
                  {totals.aheadCents > 0 && (
                    <div className="est-tax-note">
                      {moneyCents(totals.aheadCents)} advanced ahead
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="stat-card stat-static">
              <div className="stat-value mono">{pending.length}</div>
              <div className="stat-label">Awaiting costs</div>
            </div>
          </div>

          {/* The owner runs migrations by hand, sometimes days after a
              merge -- until 0158 is in, the page stays exactly what it
              was, and only admins are told what's missing. */}
          {!ledgerReady && everyone && (
            <p className="est-tax-note">
              Payment tracking (paid &amp; balance due) isn&rsquo;t set up yet &mdash; paste{" "}
              <code>supabase/migrations/0158_rep_commission_payouts.sql</code> into the Supabase
              SQL editor (safe to run twice), then reload this page.
            </p>
          )}

          {/* Who is owed what, one line per salesperson. The jobs table
              below explains the earning; this answers the payroll
              question the page is opened for. */}
          {ledgerReady && everyone && balanceRows.length > 0 && (
            <div className="table-scroll" style={{ marginBottom: 24 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Salesperson</th>
                    <th className="right">Earned</th>
                    <th className="right">Payable</th>
                    <th className="right">Paid</th>
                    <th className="right">Balance due</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceRows.map((b) => (
                    <tr key={b.repId}>
                      {/* The name is the filter: clicking it narrows the
                          whole page to this person's money, same as the
                          dropdown above. */}
                      <td>
                        <Link href={`/sales-commission?rep=${b.repId}`}>
                          {repNameById.get(b.repId) ?? "Unnamed"}
                        </Link>
                      </td>
                      <td className="right mono">{moneyCents(b.earnedCents)}</td>
                      <td className="right mono">{moneyCents(b.payableCents)}</td>
                      <td className="right mono">
                        {moneyCents(b.paidCents)}
                        {b.advanceCents > 0 && (
                          <div className="est-tax-note">
                            incl. {moneyCents(b.advanceCents)} advances
                          </div>
                        )}
                      </td>
                      <td className="right mono">
                        {moneyCents(b.dueCents)}
                        {b.aheadCents > 0 && (
                          <div className="est-tax-note">
                            {moneyCents(b.aheadCents)} advanced ahead
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Job</th>
                  {everyone && <th>Salesperson</th>}
                  <th className="right">Contract</th>
                  <th className="right">Net profit</th>
                  <th className="right">Their share</th>
                  <th className="right">Payable</th>
                </tr>
              </thead>
              <tbody>
                {priced.map((r) => {
                  const tiedCents = paidByJobRep.get(r.estimateId + r.repId) ?? 0;
                  return (
                    <tr key={r.estimateId + r.repId}>
                      {/* The job opens its contract -- the numbers on
                          this row are explained there (Sales Team panel,
                          costs, payment schedule). */}
                      <td>
                        <Link href={`/estimates/${r.estimateId}`}>
                          <div className="ur-name">{r.title || "Untitled job"}</div>
                          <div className="est-tax-note">{r.docNumber}</div>
                        </Link>
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
                      {/* Nil with no reason reads as "you earned nothing".
                          What is actually true is "you are owed this once
                          they pay the last invoice" -- a different sentence,
                          and the only one a rep can act on. */}
                      <td className="right mono">
                        {r.holds.length === 0 ? (
                          moneyCents(r.payableCents)
                        ) : (
                          <>
                            {moneyCents(0)}
                            <div className="est-tax-note">
                              {r.holds.map((h) => COMMISSION_HOLD_LABEL[h]).join(" · ")}
                            </div>
                          </>
                        )}
                        {tiedCents > 0 && (
                          <div className="est-tax-note">
                            {moneyCents(tiedCents)}{" "}
                            {r.holds.length > 0 ? "advanced on this job" : "paid on this job"}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {/* Jobs with no costs recorded are listed but not priced.
                    Net profit on an uncosted job is the whole contract, so
                    a figure here would promise a rep commission on the
                    sale rather than on its margin. */}
                {pending.map((r) => (
                  <tr key={r.estimateId + r.repId} style={{ opacity: 0.65 }}>
                    <td>
                      <Link href={`/estimates/${r.estimateId}`}>
                        <div className="ur-name">{r.title || "Untitled job"}</div>
                        <div className="est-tax-note">{r.docNumber}</div>
                      </Link>
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

      {ledgerReady && (
        <PayoutsPanel
          payouts={payouts}
          reps={reps}
          jobsByRep={jobsByRep}
          canRecord={canRecord}
          everyone={!!everyone}
        />
      )}

      <p className="est-tax-note">
        <strong>Earned</strong> is the share of net profit on jobs that have costs recorded.
        <strong> Payable</strong> is the part of it that has come due: commission is paid once
        the job is paid in full and the customer has signed the completion certificate.
        {ledgerReady && (
          <>
            {" "}
            <strong>Paid</strong> is everything recorded under Payments &amp; advances, and{" "}
            <strong>Balance due</strong> is Payable less Paid &mdash; counted per salesperson,
            so an advance to one person never shrinks what another is owed.
          </>
        )}
        {!everyone && " You are seeing your own jobs only."}
      </p>
    </section>
  );
}
