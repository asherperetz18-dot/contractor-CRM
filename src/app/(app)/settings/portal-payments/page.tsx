import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { AdminGate } from "@/components/admin-gate";
import { moneyCents } from "@/lib/data/types";
import { StripeDoctor } from "./stripe-doctor";
import { CompanyStripe } from "./company-stripe";

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

      {/* Setup now belongs to the company, not the deployment: each
          contractor connects their own account below. The old
          instructions here told them to set environment variables, which
          only the platform owner can do. */}
      <div className="est-pay">
        <h2 className="est-pay-title">How online payment works</h2>
        <p className="est-pay-sub">
          Create a Stripe account at <strong>stripe.com</strong> and complete their business
          verification. Cards work straight away. Turn on <strong>ACH Direct Debit</strong> under
          Settings &rarr; Payment methods too — 0.8% capped at $5 against 2.9% + 30¢ means $5
          instead of hundreds on a large deposit. Check it is enabled on the{" "}
          <strong>default</strong> payment-method configuration, which is the one checkout uses.
        </p>
        <p className="est-tax-note">
          Payment is taken on Stripe&apos;s own hosted page, so card details never reach this
          system and it stays outside PCI scope. Your secret key is encrypted before it is stored
          and is never shown again.
        </p>
      </div>

      <CompanyStripe />
      <StripeDoctor />

      {rows.length > 0 && (
        <>
          <p className="module-sub">
            Received to date: {moneyCents(received)} — the full record, with what is still
            outstanding, lives on <Link href="/payments">Payments</Link>.
          </p>
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
