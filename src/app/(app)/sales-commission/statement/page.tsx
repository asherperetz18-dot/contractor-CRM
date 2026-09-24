import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { moneyCents, COMMISSION_HOLD_LABEL, type CommissionHold } from "@/lib/data/types";
import {
  getRepCommissions,
  getCommissionReps,
  getCommissionPayouts,
} from "@/lib/actions/rep-commission";
import {
  periodBalance,
  periodBalancesByRep,
  type CommissionLineLike,
  type PayoutLike,
} from "@/lib/data/commission-payouts";
import { repDropdownOptions } from "@/lib/data/rep-options";
import { PrintButton } from "@/components/print-button";
import { StatementFilters } from "./statement-filters";
import { JobStatement } from "./job-statement";

export const dynamic = "force-dynamic";

type Company = {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
};

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function longDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function holdText(holds: CommissionHold[]) {
  return holds.map((h) => COMMISSION_HOLD_LABEL[h]).join(" · ");
}

/**
 * A commission statement: one salesperson, one pay period, printable.
 *
 * Commission is paid when the job is finished and settled -- paid in
 * full, and the completion certificate signed -- so the period is read
 * off the date the last of those cleared, not the date the job sold. A
 * job sold in March and signed off in July belongs on July's statement.
 *
 * Two sections, deliberately. The first is the money to pay now. The
 * second is everything earned and still held, with the reason against
 * each line: a rep who sold four jobs and sees one on their statement
 * assumes the report is broken, and a rep who cannot see what is holding
 * their money has nothing to chase.
 */
export default async function CommissionStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ rep?: string; from?: string; to?: string; job?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const sp = await searchParams;
  const now = new Date();
  const from = sp.from || iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = sp.to || iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const [{ rows, everyone, error }, payoutsRes, reps, { data: company }] = await Promise.all([
    getRepCommissions({ repId: sp.rep, detailFor: sp.job }),
    getCommissionPayouts({ repId: sp.rep }),
    getCommissionReps(),
    (await createClient())
      .from("company_profile")
      .select("name, address, phone, email, logo_url")
      .eq("company_id", profile.company_id)
      .maybeSingle<Company>(),
  ]);

  if (error) return <p className="error-note">{error}</p>;

  const all = rows ?? [];
  // The one-job statement (?job=<contract id>). Only this salesperson's
  // lines are in `all`, so a job that isn't theirs simply isn't found.
  const jobRows = sp.job ? all.filter((r) => r.estimateId === sp.job) : null;
  const jobOptions = [...new Map(all.map((r) => [r.estimateId, r])).values()]
    .map((r) => ({
      id: r.estimateId,
      label: `${r.customerName} · ${r.docNumber}${r.title ? ` ${r.title}` : ""}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const jobHref = (estimateId: string) => {
    const q = new URLSearchParams();
    if (sp.rep) q.set("rep", sp.rep);
    q.set("job", estimateId);
    return `/sales-commission/statement?${q.toString()}`;
  };
  // Payable lines are dated by when they qualified; held lines have no
  // date yet, so a period filter would hide them entirely.
  const payable = all.filter(
    (r) => r.qualifiedAt && r.qualifiedAt.slice(0, 10) >= from && r.qualifiedAt.slice(0, 10) <= to,
  );
  const held = all.filter((r) => r.holds.length > 0);

  const payableTotal = payable.reduce((s, r) => s + r.payableCents, 0);
  const heldTotal = held.filter((r) => !r.detail.unmeasured).reduce((s, r) => s + r.shareCents, 0);

  // Named from the selection, never from the rows. Reading it off the
  // rows meant a rep with no jobs produced a statement headed "All
  // salespeople" -- which on paper says the company paid nobody, rather
  // than that this person earned nothing.
  // Only honoured for someone who can actually filter by rep. The action
  // ignores the parameter for a rep and returns their own lines either
  // way, so trusting it here would head their own statement with a
  // colleague's name.
  const chosen = everyone && sp.rep ? reps.find((r) => r.id === sp.rep) : null;
  const forWhom = chosen
    ? chosen.name
    : everyone
      ? "All salespeople"
      : (all[0]?.repName ?? profile.name ?? "");
  const oneRep = !!chosen || !everyone;

  // The payout ledger (0158): what has actually been handed over, so
  // the statement can close with a balance rather than re-asking for
  // money already paid. Until the migration runs, ledgerReady is false
  // and the statement prints exactly what it always did.
  const ledgerReady = payoutsRes.ledgerReady === true;
  const payouts = payoutsRes.payouts ?? [];
  const periodPayouts = payouts.filter((p) => p.paidOn >= from && p.paidOn <= to);
  const periodPaidTotal = periodPayouts.reduce((s, p) => s + p.amountCents, 0);

  const lines: CommissionLineLike[] = all.map((r) => ({
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

  // One rep reads like a bank statement; across reps each line is its
  // own balance, because netting one rep's advance against another's
  // wages would print a payroll short.
  const balance = ledgerReady && oneRep ? periodBalance(lines, payoutLikes, from, to) : null;
  const balancesByRep =
    ledgerReady && !oneRep ? periodBalancesByRep(lines, payoutLikes, from, to) : null;

  const repNameById = new Map<string, string>();
  for (const r of reps) repNameById.set(r.id, r.name);
  for (const r of all) repNameById.set(r.repId, r.repName);
  for (const p of payouts) repNameById.set(p.repId, p.repName);

  const balanceRows = balancesByRep
    ? [...balancesByRep.entries()]
        .filter(([, b]) => b.openingCents !== 0 || b.qualifiedCents !== 0 || b.paidCents !== 0)
        .sort((a, b) => (repNameById.get(a[0]) ?? "").localeCompare(repNameById.get(b[0]) ?? ""))
    : [];
  const totalDue = balanceRows.reduce((s, [, b]) => s + Math.max(0, b.closingCents), 0);
  const totalAhead = balanceRows.reduce((s, [, b]) => s + Math.max(0, -b.closingCents), 0);
  // The number the statement is opened for: what to actually pay.
  const headBalance = balance ? balance.closingCents : totalDue;

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Commission statement</h1>
          <p className="module-sub">
            What is payable for a period, and what is still held back &mdash; printable.
          </p>
        </div>
        <div className="toolbar-actions">
          <Link href="/sales-commission" className="btn-ghost">
            Back to commission
          </Link>
          <PrintButton label="Print / Save as PDF" />
        </div>
      </div>

      <StatementFilters
        // Salespeople only, plus anyone with a commission line and the
        // rep already picked in the URL, so no statement goes unheadable.
        reps={repDropdownOptions(reps, [sp.rep, ...all.map((r) => r.repId)])}
        repId={sp.rep ?? ""}
        jobs={jobOptions}
        jobId={sp.job ?? ""}
        from={from}
        to={to}
        canChooseRep={!!everyone}
      />

      <div className="estdoc-preview-frame">
        <div className="estdoc">
          <header className="estdoc-head">
            <div className="estdoc-company">
              {company?.logo_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={company.logo_url} alt="" className="estdoc-logo" />
              )}
              <div>
                <h1 className="estdoc-company-name">{company?.name || "Commission"}</h1>
                {company?.address && <div className="estdoc-muted">{company.address}</div>}
                <div className="estdoc-muted">
                  {[company?.phone, company?.email].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
            <div className="estdoc-meta">
              <div className="estdoc-doctype">
                {jobRows ? "JOB COMMISSION STATEMENT" : "COMMISSION STATEMENT"}
              </div>
              {!jobRows && (
                <div className="estdoc-muted">
                  {longDate(from)} &ndash; {longDate(to)}
                </div>
              )}
              <div className="estdoc-muted">Prepared {longDate(iso(now))}</div>
            </div>
          </header>

          {jobRows ? (
            jobRows.length === 0 ? (
              <p className="estdoc-muted">
                That job isn&rsquo;t on this salesperson&rsquo;s commission. Pick another job above.
              </p>
            ) : (
              <JobStatement
                rows={jobRows}
                payouts={payouts.filter((p) => p.estimateId === sp.job)}
                ledgerReady={ledgerReady}
              />
            )
          ) : (
            <>
              <div className="estdoc-parties">
                <div>
                  <div className="estdoc-label">Salesperson</div>
                  <div className="estdoc-strong">{forWhom || "—"}</div>
                </div>
                <div>
                  {/* With the ledger in, the headline is what to actually
                  write the cheque for -- payable less already paid. */}
                  <div className="estdoc-label">
                    {ledgerReady
                      ? headBalance < 0
                        ? "Advanced ahead"
                        : "Balance due"
                      : "Payable this period"}
                  </div>
                  <div className="estdoc-strong mono">
                    {ledgerReady ? moneyCents(Math.abs(headBalance)) : moneyCents(payableTotal)}
                  </div>
                </div>
              </div>

              <h2 className="estdoc-terms-head">Payable this period</h2>
              {payable.length === 0 ? (
                <p className="estdoc-muted">
                  No commission qualified for payment between {longDate(from)} and {longDate(to)}.
                  Commission becomes payable when a job is paid in full and its completion
                  certificate is signed.
                </p>
              ) : (
                <table className="estdoc-items estdoc-schedule-table">
                  <thead>
                    <tr>
                      <th>Job</th>
                      {!oneRep && <th>Salesperson</th>}
                      <th>Qualified</th>
                      <th className="estdoc-num">Contract</th>
                      <th className="estdoc-num">Net profit</th>
                      <th className="estdoc-num">Rate</th>
                      <th className="estdoc-num">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payable.map((r) => (
                      <tr key={r.estimateId + r.repId}>
                        <td>
                          <Link href={jobHref(r.estimateId)} className="stmt-job-link">
                            <strong>{r.customerName}</strong>
                          </Link>
                          <div className="estdoc-muted">
                            {r.docNumber}
                            {r.title ? ` · ${r.title}` : ""}
                          </div>
                        </td>
                        {!oneRep && <td>{r.repName}</td>}
                        <td>{longDate(r.qualifiedAt)}</td>
                        <td className="estdoc-num">{moneyCents(r.detail.contractCents)}</td>
                        <td className="estdoc-num">
                          {moneyCents(r.detail.netProfitCents)}
                          <div className="estdoc-muted">
                            less {moneyCents(r.detail.leadCostCents)} lead ·{" "}
                            {moneyCents(r.detail.expensesCents)} costs
                          </div>
                        </td>
                        {/* Printed per line because it is stamped per contract:
                        two jobs on one statement can legitimately differ, and
                        an unexplained 50% beside a 40% reads as an error. */}
                        <td className="estdoc-num">
                          {(r.detail.poolCents
                            ? (r.shareCents / r.detail.poolCents) * 100
                            : 100
                          ).toFixed(0)}
                          % of pool
                        </td>
                        <td className="estdoc-num">{moneyCents(r.payableCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="estdoc-totals">
                <div className="estdoc-total-row estdoc-grand">
                  <span>Total payable</span>
                  <span className="mono">{moneyCents(payableTotal)}</span>
                </div>
              </div>

              <h2 className="estdoc-terms-head">Earned &mdash; not yet payable</h2>
              {held.length === 0 ? (
                <p className="estdoc-muted">Nothing outstanding.</p>
              ) : (
                <>
                  <p className="estdoc-muted">
                    Sold and credited to {oneRep ? "this salesperson" : "the team"}, waiting on the
                    conditions below. These are not part of the total above.
                  </p>
                  <table className="estdoc-items estdoc-schedule-table">
                    <thead>
                      <tr>
                        <th>Job</th>
                        {!oneRep && <th>Salesperson</th>}
                        <th>Signed</th>
                        <th className="estdoc-num">Contract</th>
                        <th className="estdoc-num">Collected</th>
                        <th className="estdoc-num">Commission</th>
                        <th>Waiting on</th>
                      </tr>
                    </thead>
                    <tbody>
                      {held.map((r) => (
                        <tr key={r.estimateId + r.repId}>
                          <td>
                            <Link href={jobHref(r.estimateId)} className="stmt-job-link">
                              <strong>{r.customerName}</strong>
                            </Link>
                            <div className="estdoc-muted">{r.docNumber}</div>
                          </td>
                          {!oneRep && <td>{r.repName}</td>}
                          <td>{longDate(r.signedAt)}</td>
                          <td className="estdoc-num">{moneyCents(r.detail.contractCents)}</td>
                          <td className="estdoc-num">
                            {moneyCents(r.collectedCents)}
                            <div className="estdoc-muted">{(r.collectedPct * 100).toFixed(0)}%</div>
                          </td>
                          {/* An uncosted job's "net profit" is the whole
                          contract, so a figure here would promise a share
                          of the sale rather than of the margin. */}
                          <td className="estdoc-num">
                            {r.detail.unmeasured ? "—" : moneyCents(r.shareCents)}
                          </td>
                          <td className="estdoc-muted">
                            {holdText(r.holds)}
                            {/* The usual reason a job with receipts reads
                            uncosted: they're on a customer with several
                            contracts and filed to none of them. */}
                            {r.unassignedCosts.count > 0 && (
                              <div className="stmt-warning-inline">
                                {r.unassignedCosts.count} bill
                                {r.unassignedCosts.count === 1 ? "" : "s"} (
                                {moneyCents(r.unassignedCosts.cents)}) not assigned to a contract
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="estdoc-totals">
                    <div className="estdoc-total-row">
                      <span>Held back</span>
                      <span className="mono">{moneyCents(heldTotal)}</span>
                    </div>
                  </div>
                </>
              )}

              {ledgerReady && (
                <>
                  <h2 className="estdoc-terms-head">Paid &amp; advances this period</h2>
                  {periodPayouts.length === 0 ? (
                    <p className="estdoc-muted">
                      No commission payments or advances were recorded between {longDate(from)} and{" "}
                      {longDate(to)}.
                    </p>
                  ) : (
                    <>
                      <table className="estdoc-items estdoc-schedule-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            {!oneRep && <th>Salesperson</th>}
                            <th>Against</th>
                            <th>Type</th>
                            <th className="estdoc-num">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {periodPayouts.map((p) => (
                            <tr key={p.id}>
                              <td>{longDate(p.paidOn)}</td>
                              {!oneRep && <td>{p.repName}</td>}
                              <td>
                                {p.docNumber ? (
                                  <>
                                    <strong>{p.docNumber}</strong>
                                    {p.jobTitle && <div className="estdoc-muted">{p.jobTitle}</div>}
                                  </>
                                ) : (
                                  <span className="estdoc-muted">General</span>
                                )}
                                {p.note && <div className="estdoc-muted">{p.note}</div>}
                              </td>
                              <td>{p.kind === "advance" ? "Advance" : "Payout"}</td>
                              <td className="estdoc-num">{moneyCents(p.amountCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="estdoc-totals">
                        <div className="estdoc-total-row">
                          <span>Paid this period</span>
                          <span className="mono">{moneyCents(periodPaidTotal)}</span>
                        </div>
                      </div>
                    </>
                  )}

                  <h2 className="estdoc-terms-head">Balance</h2>
                  {balance ? (
                    /* One salesperson: read like a bank statement. */
                    <div className="estdoc-totals">
                      <div className="estdoc-total-row">
                        <span>Balance carried in</span>
                        <span className="mono">{moneyCents(balance.openingCents)}</span>
                      </div>
                      <div className="estdoc-total-row">
                        <span>Came due this period</span>
                        <span className="mono">{moneyCents(balance.qualifiedCents)}</span>
                      </div>
                      <div className="estdoc-total-row">
                        <span>Paid this period</span>
                        <span className="mono">&minus;{moneyCents(balance.paidCents)}</span>
                      </div>
                      <div className="estdoc-total-row estdoc-grand">
                        <span>{balance.closingCents < 0 ? "Advanced ahead" : "Balance due"}</span>
                        <span className="mono">{moneyCents(Math.abs(balance.closingCents))}</span>
                      </div>
                    </div>
                  ) : balanceRows.length === 0 ? (
                    <p className="estdoc-muted">
                      Nothing owed and nothing advanced as of {longDate(to)}.
                    </p>
                  ) : (
                    /* Every salesperson their own line -- one rep's advance
                   never nets against another rep's wages. */
                    <>
                      <table className="estdoc-items estdoc-schedule-table">
                        <thead>
                          <tr>
                            <th>Salesperson</th>
                            <th className="estdoc-num">Carried in</th>
                            <th className="estdoc-num">Came due</th>
                            <th className="estdoc-num">Paid</th>
                            <th className="estdoc-num">Balance due</th>
                          </tr>
                        </thead>
                        <tbody>
                          {balanceRows.map(([repId, b]) => (
                            <tr key={repId}>
                              <td>{repNameById.get(repId) ?? "Unnamed"}</td>
                              <td className="estdoc-num">{moneyCents(b.openingCents)}</td>
                              <td className="estdoc-num">{moneyCents(b.qualifiedCents)}</td>
                              <td className="estdoc-num">{moneyCents(b.paidCents)}</td>
                              <td className="estdoc-num">
                                {b.closingCents < 0 ? (
                                  <>
                                    {moneyCents(-b.closingCents)}
                                    <div className="estdoc-muted">ahead</div>
                                  </>
                                ) : (
                                  moneyCents(b.closingCents)
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="estdoc-totals">
                        <div className="estdoc-total-row estdoc-grand">
                          <span>Total balance due</span>
                          <span className="mono">{moneyCents(totalDue)}</span>
                        </div>
                        {totalAhead > 0 && (
                          <div className="estdoc-total-row">
                            <span>Advanced ahead, nets against future commission</span>
                            <span className="mono">{moneyCents(totalAhead)}</span>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}

          <div className="estdoc-terms">
            <p>
              Commission is a share of each job&rsquo;s net profit &mdash; the contract less the
              lead cost and the money actually spent on the work. It becomes payable when the job is
              paid in full and the customer has signed the completion certificate.
            </p>
            {ledgerReady && (
              <p>
                Payments and advances are deducted from the balance due. An advance is money given
                before its job settled; paid past what has qualified, it shows as &ldquo;advanced
                ahead&rdquo; and nets against that salesperson&rsquo;s next settled commission.
              </p>
            )}
            {/* A printed sheet outlives the screen it came from. Six
                months on, nobody remembers the costs were still landing. */}
            <p>
              Figures are provisional while costs are still being recorded against a job, and are
              calculated at the rate stamped on each contract at the time it was signed.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
