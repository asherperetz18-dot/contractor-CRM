import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PORTAL_PENDING_COOKIE,
  getPendingChallengeCompany,
  getPortalViewer,
} from "@/lib/portal/session";
import { PortalChallengeForm } from "./portal-challenge-form";

export const metadata = {
  title: "Portal Access",
};

export default async function PortalConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Same allowlist the verify route applies -- re-checked here because a
  // query string can be edited directly in the address bar.
  const safeNext =
    next && /^\/portal\/[A-Za-z0-9/_-]*$/.test(next) ? next : "/portal/home";

  const viewer = await getPortalViewer();
  if (viewer) redirect(safeNext);

  const store = await cookies();
  if (!store.get(PORTAL_PENDING_COOKIE)) redirect("/portal");

  // Safe to brand this screen: the sign-in link already identifies which
  // customer -- and therefore which company -- is signing in.
  const companyId = await getPendingChallengeCompany();
  let companyName = "Your Contractor";
  let logoUrl: string | null = null;

  if (companyId) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("company_profile")
      .select("name, logo_url")
      .eq("company_id", companyId)
      .maybeSingle();
    const row = data as { name: string | null; logo_url: string | null } | null;
    companyName = row?.name || companyName;
    logoUrl = row?.logo_url ?? null;
  }

  return <PortalChallengeForm companyName={companyName} logoUrl={logoUrl} next={safeNext} />;
}
