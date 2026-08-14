import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  isAdminRole,
  moneyCents,
  COMMISSION_HOLD_LABEL,
  type CommissionHold,
} from "@/lib/data/types";
import { getDispatcherCommissions, type CommissionJob } from "@/lib/actions/dispatcher";
import { PrintButton } from "@/components/print-button";
import { DispatcherStatementFilters } from "./statement-filters";

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
 * A dispatcher commission statement: one person, one pay period,
 * printable.
 *
 * Same shape as the sales rep statement and the same two release
 * conditions -- paid in full and the completion certificate signed --
 * but a different scheme underneath: a percentage of the gross sale for
 * bringing the lead in, not a share of what the job made. So there is no
 * lead cost, no job costs and no net profit here, and none are shown.
 * Putting them on would invite the two schemes to be read as one.
 */
export default async function DispatcherStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ who?: string; from?: string; to?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const sp = await searchParams;
  const now = new Date();
  const from = sp.from || iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = sp.to || iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const [{ rows, ratePercent, error }, { data: company }] = await Promise.all([
    getDispatcherCommissions(),
    (await createClient())
      .from("company_profile")
      .select("name, address, phone, email, logo_url")
      .eq("company_id", profile.company_id)
      .maybeSingle<Company>(),
  ]);

  if (error) return <p className="error-note">{error}</p>;

  const everyone = isAdminRole(profile);
  const all = rows ?? [];
  const dispatchers = all.map((r) => ({ id: r.dispatcherId, name: r.dispatcherName }));

  // Only honoured for someone who can actually filter. The action returns
  // a dispatcher their own rows regardless, so trusting the parameter
  // would head their statement with a colleague's name.
  const chosen = everyone && sp.who ? all.find((r) => r.dispatcherId === sp.who) : null;
  const shown = chosen ? [chosen] : all;
  const oneOnly = !!chosen || !everyone;
  const forWhom = chosen
    ? chosen.dispatcherName
    : everyone
      ? "All dispatchers"
      : (all[0]?.dispatcherName ?? profile.name ?? "");

  type Line = CommissionJob & { dispatcherName: string };
  const lines: Line[] = shown.flatMap((r) =>
    r.jobs.map((j) => ({ ...j, dispatcherName: r.dispatcherName }))
  );

  // Payable lines are dated by when they qualified; held lines have no
  // date yet, so a period filter would hide them entirely.
  const payable = lines.filter(
    (j) => j.qualifiedAt && j.qualifiedAt.slice(0, 10) >= from && j.qualifiedAt.slice(0, 10) <= to
  );
  const held = lines.filter((j) => j.holds.length > 0);
  const payableTotal = payable.reduce((s, j) => s + j.payableCents, 0);
  const heldTotal = held.reduce((s, j) => s + j.commissionCents, 0);

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Dispatcher statement</h1>
          <p className="module-sub">
            What is payable for a period, and what is still held back &mdash; printable.
          </p>
        </div>
        <div className="toolbar-actions">
          <Link href="/commissions" className="btn-ghost">
            Back to commissions
          </Link>
          <PrintButton label="Print / Save as PDF" />
        </div>
      </div>

      <DispatcherStatementFilters
        dispatchers={dispatchers}
        dispatcherId={sp.who ?? ""}
        from={from}
        to={to}
        canChoose={everyone}
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
              <div className="estdoc-doctype">DISPATCHER COMMISSION</div>
              <div className="estdoc-muted">
                {longDate(from)} &ndash; {longDate(to)}
              </div>
              <div className="estdoc-muted">Prepared {longDate(iso(now))}</div>
            </div>
          </header>

          <div className="estdoc-parties">
            <div>
              <div className="estdoc-label">Dispatcher</div>
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
              Commission becomes payable when the job is paid in full and its completion
              certificate is signed.
            </p>
          ) : (
            <table className="estdoc-items estdoc-schedule-table">
              <thead>
                <tr>
                  <th>Job</th>
                  {!oneOnly && <th>Dispatcher</th>}
                  <th>Qualified</th>
                  <th className="estdoc-num">Contract</th>
                  <th className="estdoc-num">Rate</th>
                  <th className="estdoc-num">Commission</th>
                </tr>
              </thead>
              <tbody>
                {payable.map((j) => (
                  <tr key={j.estimateId + j.dispatcherName}>
                    <td>
                      <strong>{j.customerName}</strong>
                      <div className="estdoc-muted">{j.docNumber}</div>
                    </td>
                    {!oneOnly && <td>{j.dispatcherName}</td>}
                    <td>{longDate(j.qualifiedAt)}</td>
                    <td className="estdoc-num">
                      {moneyCents(j.contractCents)}
                      {/* Only when they differ, so the ordinary job stays
                          uncluttered -- but a change order has to be
                          visible, or the commission looks miscalculated
                          against the amount the customer actually paid. */}
                      {j.jobValueCents !== j.contractCents && (
                        <div className="estdoc-muted">
                          job total {moneyCents(j.jobValueCents)} with change orders
                        </div>
                      )}
                    </td>
                    <td className="estdoc-num">{(ratePercent ?? 1).toFixed(2)}%</td>
                    <td className="estdoc-num">{moneyCents(j.payableCents)}</td>
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
                Leads brought in and sold, waiting on the conditions below. These are not part of
                the total above.
              </p>
              <table className="estdoc-items estdoc-schedule-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    {!oneOnly && <th>Dispatcher</th>}
                    <th>Signed</th>
                    <th className="estdoc-num">Contract</th>
                    <th className="estdoc-num">Collected</th>
                    <th className="estdoc-num">Commission</th>
                    <th>Waiting on</th>
                  </tr>
                </thead>
                <tbody>
                  {held.map((j) => (
                    <tr key={j.estimateId + j.dispatcherName}>
                      <td>
                        <strong>{j.customerName}</strong>
                        <div className="estdoc-muted">{j.docNumber}</div>
                      </td>
                      {!oneOnly && <td>{j.dispatcherName}</td>}
                      <td>{longDate(j.signedAt)}</td>
                      <td className="estdoc-num">{moneyCents(j.jobValueCents)}</td>
                      <td className="estdoc-num">
                        {moneyCents(j.collectedCents)}
                        <div className="estdoc-muted">
                          {j.jobValueCents > 0
                            ? `${Math.round((j.collectedCents / j.jobValueCents) * 100)}%`
                            : "—"}
                        </div>
                      </td>
                      <td className="estdoc-num">{moneyCents(j.commissionCents)}</td>
                      <td className="estdoc-muted">{holdText(j.holds)}</td>
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
              Dispatcher commission is {(ratePercent ?? 1).toFixed(2)}% of the gross sale on every
              contract signed on a lead this dispatcher brought in. It becomes payable when the
              job is paid in full and the customer has signed the completion certificate.
            </p>
            <p>
              Paid in full means the whole job including any change orders, so a contract can be
              settled while the job it belongs to is not. Commission is calculated on the original
              contract only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
