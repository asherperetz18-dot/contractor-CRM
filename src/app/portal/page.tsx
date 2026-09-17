import { redirect } from "next/navigation";
import { getPortalViewer } from "@/lib/portal/session";
import { portalLoginNotice } from "@/lib/portal/login-notice";
import { PortalLoginForm } from "./portal-login-form";

export const metadata = {
  title: "Project Portal",
};

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const viewer = await getPortalViewer();
  if (viewer) redirect("/portal/home");
  // A dead sign-in link redirects here with ?error= -- shown, not
  // dropped, so the visitor knows their click failed and that the form
  // below is how they get a fresh link (login-notice.ts).
  const { error } = await searchParams;
  return <PortalLoginForm notice={portalLoginNotice(error)} />;
}
