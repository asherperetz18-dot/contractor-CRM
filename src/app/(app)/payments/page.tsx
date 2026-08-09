import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import {
  collectionsSummary,
  moneyCents,
  paymentMethodLabel,
  type PortalPayment,
  type SignedContract,
} from "@/lib/data/types";
import { getStripeEnv } from "@/lib/stripe-env";

export const dynamic = "force-dynamic";

type ContractRow = SignedContract & {
  doc_number: string;
  title: string | null;
  lead_id: string | null;
};

type LeadRow = { id: string; first_name: string | null; last_name: string | null };

// portal_payments carries lead_id; the shared PortalPayment type covers
// only what the estimate document needs, so widen it here rather than
// adding a column the other call sites don't select.
type PaymentRow = PortalPayment & { lead_id: string | null };

function statusBadge(status: string) {
  if (status === "succeeded") return "signed";
  if (status === "failed") return "declined";
  return "sent";
}

/**
 * Where the money is.
 *
 * This used to live at /settings/portal-payments with nothing linking to
 * it, so the only way to see what customers had paid was to type the URL
 * -- which is the same as it not existing. Settings keeps the Stripe
 * connection steps; the money itself belongs on its own page.
 */
export default async function PaymentsPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const env = getStripeEnv();

  const [payments, contracts] = await Promise.all([
    selectAll<PaymentRow>((from, to) =>
      supabase
        .from("portal_payments")
        .select("id, estimate_id, lead_id, kind, amount_cents, status, method, paid_at, created_at")
        .eq("company_id", profile.company_id)
        .order("created_at", { ascending: false })
        .range(from, to)
    ),
    // Only signed estimates are contracts. A draft is not money owed.
    selectAll<ContractRow>((from, to) =>
      supabase
        .from("estimates")
        .select("id, doc_number, title, total_cents, deposit_cents, lead_id")
        .eq("company_id", profile.company_id)
        .eq("status", "Signed")
        .range(from, to)
    ),
  ]);

  const leadIds = [
    ...new Set([...contracts, ...payments].map((r) => r.lead_id).filter(Boolean) as string[]),
  ];
  const leads = leadIds.length
    ? await selectAll<LeadRow>((from, to) =>
        supabase
          .from("leads")
          .select("id, first_name, last_name")
          .eq("company_id", profile.company_id)
          .in("id", leadIds)
          .range(from, to)
      )
    : [];
  const nameOf = (leadId: string | null) => {
    const l = leads.find((x) => x.id === leadId);
    return [l?.first_name, l?.last_name].filter(Boolean).join(" ").trim() || "—";
  };
  const docOf = (estimateId: string) =>
    contracts.find((c) => c.id === estimateId) ?? null;

  const s = collectionsSummary(contracts, payments);
  const settledDeposits = new Set(
    payments.filter((p) => p.status === "succeeded" && p.kind === "deposit").map((p) => p.estimate_id)
  );
  const chase = contracts
    .filter((c) => (c.deposit_cents || 0) > 0 && !settledDeposits.has(c.id))
    .sort((a, b) => (b.deposit_cents || 0) - (a.deposit_cents || 0));

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Payments</h1>
          <p className="module-sub">
            Money collected through the customer portal, and what is still out on signed contracts.
          </p>
        </div>
      </div>

      {!env && (
        <p className="hint-note">
          Stripe isn&apos;t connected yet, so customers can&apos;t pay online — set it up in Admin
          Settings &rarr; Portal Payments. Signed contract totals below are still accurate.
        </p>
      )}

      <div className="stat-grid stat-grid-5">
        <div className={"stat-card stat-static" + (s.collectedCents > 0 ? " stat-card-won" : "")}>
          <div className="stat-value mono">{moneyCents(s.collectedCents)}</div>
          <div className="stat-label">Collected</div>
        </div>
        <div className={"stat-card stat-static" + (s.outstandingCents > 0 ? " stat-card-gold" : "")}>
          <div className="stat-value mono">{moneyCents(s.outstandingCents)}</div>
          <div className="stat-label">Outstanding</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(s.contractValueCents)}</div>
          <div className="stat-label">Signed Contracts</div>
        </div>
        <div
          className={"stat-card stat-static" + (s.awaitingDepositCents > 0 ? " stat-card-gold" : "")}
        >
          <div className="stat-value mono">{moneyCents(s.awaitingDepositCents)}</div>
          <div className="stat-label">Deposits Not Paid</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(s.clearingCents)}</div>
          <div className="stat-label">Clearing (ACH)</div>
        </div>
      </div>

      {/* The only figure on this page that is a to-do list rather than a
          number: these are signed jobs where the deposit never landed. */}
      {chase.length > 0 && (
        <section className="pay-section">
          <h2 className="pay-section-title">
            Deposits to chase ({s.awaitingDepositCount})
          </h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Customer</th>
                <th className="right">Contract value</th>
                <th className="right">Deposit due</th>
              </tr>
            </thead>
            <tbody>
              {chase.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link className="link-plain" href={`/estimates/${c.id}`}>
                      <span className="ur-name mono">{c.doc_number}</span>
                    </Link>
                    <div className="ur-add-phone">{c.title || "Untitled"}</div>
                  </td>
                  <td>{nameOf(c.lead_id)}</td>
                  <td className="right mono">{moneyCents(c.total_cents)}</td>
                  <td className="right mono">{moneyCents(c.deposit_cents || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="pay-section">
        <h2 className="pay-section-title">Payment history</h2>
        {payments.length === 0 ? (
          <div className="empty-state">
            <p className="empty-label">No payments yet</p>
            <p className="empty-hint">
              Once a customer signs and pays a deposit through the portal, it lands here with the
              method and date.
            </p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Customer</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Method</th>
                <th>Date</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const c = docOf(p.estimate_id);
                return (
                  <tr key={p.id}>
                    <td>
                      {c ? (
                        <Link className="link-plain" href={`/estimates/${c.id}`}>
                          <span className="ur-name mono">{c.doc_number}</span>
                        </Link>
                      ) : (
                        <span className="ur-name mono">—</span>
                      )}
                    </td>
                    <td>{nameOf(p.lead_id ?? c?.lead_id ?? null)}</td>
                    <td>{p.kind === "deposit" ? "Deposit" : "Progress"}</td>
                    <td>
                      <span className={"est-badge est-badge-" + statusBadge(p.status)}>
                        {p.status}
                      </span>
                    </td>
                    <td>{paymentMethodLabel(p.method) || "—"}</td>
                    <td>{new Date(p.paid_at ?? p.created_at).toLocaleDateString("en-US")}</td>
                    <td className="right mono">{moneyCents(p.amount_cents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Said out loud because its absence is otherwise indistinguishable
          from "nothing is late". */}
      <p className="est-tax-note">
        There is no overdue figure here yet: progress payments are milestones (&ldquo;at completion
        of rough-in&rdquo;), not dates, so nothing in a contract can be late. Due dates arrive with
        progress billing.
      </p>
    </div>
  );
}
