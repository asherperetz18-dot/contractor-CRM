import "server-only";
import { getCompanyBilling } from "@/lib/billing/company-billing";
import { isBillingLocked } from "@/lib/billing/subscription";
import { getCompanyClosure } from "@/lib/billing/company-closure";

/**
 * A locked company is paused, not just hidden (DECISIONS #131). The app
 * layout already sends its people to the lock screen and row-level
 * security hides its data (0175) -- but texts, calls, AI and scheduled
 * jobs run on the service-role client, which RLS doesn't touch, and a
 * server action or API route is reachable without the layout. Every one
 * of those asks here.
 *
 * Cached with the app shell's billing read (company-billing tag), which
 * the Stripe webhook drops the moment a subscription changes, so a
 * renewal turns everything back on at once.
 */
export async function isCompanyLocked(companyId: string): Promise<boolean> {
  const [billing, closure] = await Promise.all([getCompanyBilling(companyId), getCompanyClosure(companyId)]);
  // A closed company (DECISIONS #135) is locked exactly like a lapsed one.
  return isBillingLocked(billing?.status) || closure !== null;
}

export const LOCKED_SERVICES_ERROR =
  "This company's AI Build Pro subscription has ended, so texting, calling and AI are paused until it's renewed.";

export const CLOSED_SERVICES_ERROR =
  "This company's AI Build Pro account is closed, so texting, calling and AI are off.";

/** The error to show for a locked company, or null when it may go ahead. */
export async function lockedServicesError(companyId: string): Promise<string | null> {
  if (await getCompanyClosure(companyId)) return CLOSED_SERVICES_ERROR;
  return (await isCompanyLocked(companyId)) ? LOCKED_SERVICES_ERROR : null;
}
