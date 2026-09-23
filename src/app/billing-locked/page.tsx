import { redirect } from "next/navigation";
import { getCurrentProfile, getCurrentUserCompanies } from "@/lib/data/profile";
import { isAdminRole, isPlatformAdmin } from "@/lib/data/types";
import { readCompanyBilling } from "@/lib/billing/company-billing";
import { isBillingLocked } from "@/lib/billing/subscription";
import { BillingLockActions } from "./billing-lock-actions";

export const metadata = { title: "Subscription ended" };

// Never cached: whether this company is locked is the whole question.
export const dynamic = "force-dynamic";

/**
 * Where the app layout sends everyone in a company whose AI Build Pros
 * subscription has lapsed. Outside the (app) group on purpose -- inside
 * it, the layout's own redirect would send this page to itself.
 */
export default async function BillingLockedPage({
  searchParams,
}: {
  searchParams: Promise<{ renewed?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  // Read fresh, not from the layout's cache, so the moment a renewal
  // lands this page lets them straight back in.
  const billing = await readCompanyBilling(profile.company_id);
  if (!isBillingLocked(billing?.status) || isPlatformAdmin(profile)) redirect("/");

  const { renewed } = await searchParams;
  const companies = await getCurrentUserCompanies();
  const current = companies.find((c) => c.company_id === profile.company_id);
  const others = companies.filter((c) => c.company_id !== profile.company_id);
  const companyName = current?.company_name?.trim() || "Your company";

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-title">{companyName}&apos;s subscription has ended</h1>
        <p className="auth-sub">
          The AI Build Pros subscription for {companyName} is no longer active, so the CRM is
          locked. Nothing has been deleted — everything comes back as soon as the subscription
          is renewed.
        </p>
        <BillingLockActions
          canManage={isAdminRole(profile)}
          renewed={renewed === "1"}
          otherCompanies={others}
        />
      </div>
      <footer className="site-footer">
        © 2026 AI Build Pros LLC. All rights reserved.
      </footer>
    </div>
  );
}
