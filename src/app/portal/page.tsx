import { redirect } from "next/navigation";
import { getPortalViewer } from "@/lib/portal/session";
import { PortalLoginForm } from "./portal-login-form";

export const metadata = {
  title: "Project Portal",
};

export default async function PortalLoginPage() {
  const viewer = await getPortalViewer();
  if (viewer) redirect("/portal/home");
  return <PortalLoginForm />;
}
