import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { AdminGate } from "@/components/admin-gate";
import { moneyCents } from "@/lib/data/types";
import { getStripeEnv } from "@/lib/stripe-env";

export const dynamic = "force-dynamic";

type PaymentRow = {
  id: string;
  amount_cents: number;
  status: string;
  method: string | null;
  paid_at: string | null;
  created_at: string;
  estimates: { doc_number: string; title: string } | null;
};

export default async function PortalPaymentsPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const env = getStripeEnv();
  const supabase = await createClient();
  const { data } = await supabase
    .from("portal_payments")
    .select("id, amount_cents, status, method, paid_at, created_at, estimates(doc_number, title)")
    .eq("company_id", profile.company_id)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<PaymentRow[]>();

  const rows = data ?? [];
  const received = rows
    .filter((r) => r.status === "succeeded")
    .reduce((s, r) => s + r.amount_cents, 0);

  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Portal Payments</h1>
          <p className="module-sub">
            Deposits customers have paid online, by card or bank transfer
          </p>
        </div>
      </div>

      {!env ? (
        <div className="est-pay">
          <h2 className="est-pay-title">Not connected yet</h2>
          <p className="est-pay-sub">
            Customers can&apos;t pay online until Stripe is connected. Nothing else in the portal
            is affected — the Pay Deposit panel simply doesn&apos;t appear.
          </p>
          <ol className="pp-steps">
            <li>
              Create a Stripe account at <strong>stripe.com</strong> and complete their business
              verification. Cards work straight away. Turn on{" "}
              <strong>ACH Direct Debit</strong> under Settings &rarr; Payment methods as well —
              0.8% capped at $5 against 2.9% + 30¢ means $5 instead of hundreds on a large
              payment, and it appears at checkout automatically once enabled.
            </li>
            <li>
              Add <code>STRIPE_SECRET_KEY</code> to this project&apos;s environment variables in
              Vercel. Paste it there, not into chat or a file in this repository.
            </li>
            <li>
              In Stripe, add a webhook pointing at{" "}
              <code>https://portal.aibuildpros.com/api/stripe/webhook</code> for the events{" "}
              <code>checkout.session.completed</code>,{" "}
              <code>checkout.session.async_payment_succeeded</code>,{" "}
              <code>checkout.session.async_payment_failed</code> and{" "}
              <code>checkout.session.expired</code>. Add its signing secret as{" "}
              <code>STRIPE_WEBHOOK_SECRET</code>.
            </li>
            <li>Redeploy. The Pay Deposit panel appears on signed estimates automatically.</li>
          </ol>
          <p className="est-tax-note">
            Payment is taken on Stripe&apos;s own hosted page, so card details never reach this
            system and it stays outside PCI scope.
          </p>
        </div>
      ) : (
        <p className="hint-note">
          Stripe is connected{env.webhookSecret ? "" : " — but STRIPE_WEBHOOK_SECRET is missing, so payments will not be recorded as paid"}.
        </p>
      )}

      {rows.length > 0 && (
        <>
          <p className="module-sub">Received to date: {moneyCents(received)}</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Estimate</th>
                <th>Status</th>
                <th>Method</th>
                <th>Date</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="ur-name">{r.estimates?.doc_number ?? "—"}</div>
                    <div className="ur-add-phone">{r.estimates?.title ?? ""}</div>
                  </td>
                  <td>
                    <span className={"est-badge est-badge-" + (r.status === "succeeded" ? "signed" : r.status === "failed" ? "declined" : "sent")}>
                      {r.status}
                    </span>
                  </td>
                  <td>{r.method === "us_bank_account" ? "Bank transfer" : r.method ?? "—"}</td>
                  <td>{new Date(r.paid_at ?? r.created_at).toLocaleDateString("en-US")}</td>
                  <td className="right mono">{moneyCents(r.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </AdminGate>
  );
}
