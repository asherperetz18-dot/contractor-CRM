import { getCurrentProfile } from "@/lib/data/profile";
import { AdminGate } from "@/components/admin-gate";
import { readCompanyBilling } from "@/lib/billing/company-billing";
import { ManageBillingButton } from "./manage-billing-button";
import { TrialCardCheck } from "./trial-card-check";
import { trialDaysLeft } from "@/lib/billing/trial";
import { getCompanyZone } from "@/lib/data/company-today";
import { createClient } from "@/lib/supabase/server";
import { usageFromRow, usageMonth, type UsageRow } from "@/lib/usage/usage";
import { formatUsageWithLimits, limitsFromRow, type LimitsRow } from "@/lib/usage/limits";

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
  const zone = await getCompanyZone();
  // This month's counts (DECISIONS #132), read as the signed-in person:
  // their own company's row only. Zeros before 0199 has run.
  const supabase = await createClient();
  const [{ data: usageRow }, { data: limitsRow }] = await Promise.all([
    supabase
      .from("company_usage")
      .select("*")
      .eq("company_id", profile.company_id)
      .eq("month", usageMonth(new Date()))
      .maybeSingle<UsageRow>(),
    // Its monthly limits (DECISIONS #133); none before 0200 has run.
    supabase.from("company_limits").select("*").eq("company_id", profile.company_id).maybeSingle<LimitsRow>(),
  ]);
  const usage = usageFromRow(usageRow);
  const limits = limitsFromRow(limitsRow);
  const hasLimits = limits.ai !== null || limits.sms !== null || limits.email !== null;
  const now = new Date().getTime();
  const trialing = billing?.status === "trialing";
  const daysLeft = trialing ? trialDaysLeft(billing?.trialEndsAt, now) : null;
  const trialEnd = billing?.trialEndsAt
    ? new Date(billing.trialEndsAt).toLocaleDateString("en-US", {
        timeZone: zone,
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

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
              {daysLeft !== null && ` — ${daysLeft === 1 ? "1 day" : `${daysLeft} days`} left`}
            </h2>
            {trialing && !billing.cardOnFile ? (
              <>
                <TrialCardCheck />
                <ManageBillingButton
                  label="Add a card"
                  intro={`Your free trial ends ${trialEnd ? `on ${trialEnd}` : "soon"}. Add a card before then to keep using AI Build Pro. You won't be charged until the trial ends. It opens on Stripe's own secure page and brings you back here.`}
                />
              </>
            ) : trialing ? (
              <ManageBillingButton
                intro={`Your card is on file. It will be charged ${trialEnd ? `on ${trialEnd}, ` : ""}when the free trial ends. You can update it, see invoices or cancel on Stripe's own secure page.`}
              />
            ) : (
              <ManageBillingButton />
            )}
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

      <div className="est-pay">
        <h2 className="est-pay-title">This month so far</h2>
        <p className="est-pay-sub">{formatUsageWithLimits(usage, limits)}</p>
        <p className="hint-note">
          Counted from the 1st of the month: answers from the AI (assistant, lead analysis, scope
          writer, call notes, AI receptionist), texts sent, and emails sent to customers.
          {hasLimits &&
            " Your plan includes the monthly amounts shown; once one is used up it stops until the 1st. Ask AI Build Pros if you need more."}
        </p>
      </div>
    </AdminGate>
  );
}
