import { getCurrentProfile } from "@/lib/data/profile";
import { AdminGate } from "@/components/admin-gate";
import { readCompanyBilling } from "@/lib/billing/company-billing";
import { ManageBillingButton } from "./manage-billing-button";

export const dynamic = "force-dynamic";

// Stripe's statuses, in the words an owner reads.
const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Free trial",
  past_due: "Payment failed — Stripe is retrying your card",
  incomplete: "Waiting for the first payment",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  incomplete_expired: "First payment never completed",
  paused: "Paused",
};

export default async function BillingSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const billing = await readCompanyBilling(profile.company_id);

  return (
    <AdminGate>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Subscription</h1>
          <p className="module-sub">Your AI Build Pro plan, card and invoices</p>
        </div>
      </div>

      <div className="est-pay">
        {billing ? (
          <>
            <h2 className="est-pay-title">
              Status: {STATUS_LABELS[billing.status ?? ""] ?? billing.status ?? "Checking with Stripe"}
            </h2>
            <p className="est-pay-sub">
              Update the card you pay with, download invoices, or cancel. It opens on
              Stripe&apos;s own secure page and brings you back here when you&apos;re done.
            </p>
            <ManageBillingButton />
          </>
        ) : (
          <>
            <h2 className="est-pay-title">No subscription on this company</h2>
            <p className="est-pay-sub">
              This company wasn&apos;t bought through the online sign-up, so there&apos;s no plan
              to manage here.
            </p>
          </>
        )}
      </div>
    </AdminGate>
  );
}
