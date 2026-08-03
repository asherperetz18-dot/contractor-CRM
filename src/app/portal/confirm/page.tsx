import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PORTAL_PENDING_COOKIE, getPortalViewer } from "@/lib/portal/session";
import { PortalChallengeForm } from "./portal-challenge-form";

export const metadata = {
  title: "Confirm it's you",
};

export default async function PortalConfirmPage() {
  const viewer = await getPortalViewer();
  if (viewer) redirect("/portal/home");

  const store = await cookies();
  if (!store.get(PORTAL_PENDING_COOKIE)) redirect("/portal");

  return <PortalChallengeForm />;
}
