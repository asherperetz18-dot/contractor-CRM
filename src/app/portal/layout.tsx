import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPendingChallengeCompany, readPortalSession } from "@/lib/portal/session";
import { portalFavicon } from "@/lib/portal/favicon";

/**
 * Brands the browser tab with the contractor's logo -- the same one the
 * page header shows -- the way the staff app's (app) layout already does.
 * The company is known once a customer is signed in, and on the passcode
 * screen from the link they clicked. The email-entry screen knows no
 * company, so it keeps the product mark from the root layout.
 */
export async function generateMetadata(): Promise<Metadata> {
  const companyId =
    (await readPortalSession())?.company_id ?? (await getPendingChallengeCompany());
  if (!companyId) return {};

  const { data } = await createAdminClient()
    .from("company_profile")
    .select("logo_url")
    .eq("company_id", companyId)
    .maybeSingle<{ logo_url: string | null }>();
  return portalFavicon(data?.logo_url);
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
