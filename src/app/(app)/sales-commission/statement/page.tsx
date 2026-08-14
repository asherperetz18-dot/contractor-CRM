import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  moneyCents,
  COMMISSION_HOLD_LABEL,
  type CommissionHold,
} from "@/lib/data/types";
import { getRepCommissions, getCommissionReps } from "@/lib/actions/rep-commission";
import { PrintButton } from "@/components/print-button";
import { StatementFilters } from "./statement-filters";

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
    d.getDate()
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
  searchParams: Promise<{ rep?: string; from?: string; to?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const sp = await searchParams;
  const now = new Date();
  const from = sp.from || iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = sp.to || iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const [{ rows, everyone, error }, reps, { data: company }] = await Promise.all([
    getRepCommissions({ repId: sp.rep }),
    getCommissionReps(),
    (await createClient())
      .from("company_profile")
      .select("name, address, phone, email, logo_url")
      .eq("company_id", profile.company_id)
      .maybeSingle<Company>(),
  ]);

  if (error) return <p className="error-note">{error}</p>;

  const all = rows ?? [];
  // Payable lines are dated by when they qualified; held lines have no
  // date yet, so a period filter would hide them entirely.
  const payable = all.filter(
    (r) => r.qualifiedAt && r.qualifiedAt.slice(0, 10) >= from && r.qualifiedAt.slice(0, 10) <= to
  );
  const held = all.filter((r) => r.holds.length > 0);

  const payableTotal = payable.reduce((s, r) => s + r.payableCents, 0);
  const heldTotal = held
    .filter((r) => !r.detail.unmeasured)
    .reduce((s, r) => s + r.shareCents, 0);

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
        reps={reps}
        repId={sp.rep ?? ""}
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
              <div className="estdoc-doctype">COMMISSION STATEMENT</div>
              <div className="estdoc-muted">
                {longDate(from)} &ndash; {longDate(to)}
              </div>
              <div className="estdoc-muted">Prepared {longDate(iso(now))}</div>
            </div>
          </header>

          <div className="estdoc-parties">
            <div>
              <div className="estdoc-label">Salesperson</div>
              <div className="estdoc-strong">{forWhom || "—"}</div>
            </div>
            <div>
              <div className="estdoc-label">Payable this period</div>
              <div className="estdoc-strong mono">{moneyCents(payableTotal)}</div>
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
                      <strong>{r.customerName}</strong>
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
                        <strong>{r.customerName}</strong>
                        <div className="estdoc-muted">{r.docNumber}</div>
                      </td>
                      {!oneRep && <td>{r.repName}</td>}
                      <td>{longDate(r.signedAt)}</td>
                      <td className="estdoc-num">{moneyCents(r.detail.contractCents)}</td>
                      <td className="estdoc-num">
                        {moneyCents(r.collectedCents)}
                        <div className="estdoc-muted">
                          {(r.collectedPct * 100).toFixed(0)}%
                        </div>
                      </td>
                      {/* An uncosted job's "net profit" is the whole
                          contract, so a figure here would promise a share
                          of the sale rather than of the margin. */}
                      <td className="estdoc-num">
                        {r.detail.unmeasured ? "—" : moneyCents(r.shareCents)}
                      </td>
                      <td className="estdoc-muted">{holdText(r.holds)}</td>
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

          <div className="estdoc-terms">
            <p>
              Commission is a share of each job&rsquo;s net profit &mdash; the contract less the
              lead cost and the money actually spent on the work. It becomes payable when the
              job is paid in full and the customer has signed the completion certificate.
            </p>
            {/* A printed sheet outlives the screen it came from. Six
                months on, nobody remembers the costs were still landing. */}
            <p>
              Figures are provisional while costs are still being recorded against a job, and
              are calculated at the rate stamped on each contract at the time it was signed.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
