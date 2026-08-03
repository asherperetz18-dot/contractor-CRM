import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalViewer } from "@/lib/portal/session";
import type { Event, Profile, SmsMessage } from "@/lib/data/types";
import { PortalHome } from "./portal-home";

export const metadata = {
  title: "Your Project",
};

type PortalFile = {
  id: string;
  file_name: string;
  file_url: string | null;
  content_type: string | null;
  created_at: string;
  uploaded_by: string | null;
};

export default async function PortalHomePage() {
  const viewer = await getPortalViewer();
  if (!viewer) redirect("/portal");

  const admin = createAdminClient();
  const [
    { data: events },
    { data: files },
    { data: messages },
    { data: company },
    { data: reps },
  ] = await Promise.all([
    admin
      .from("events")
      .select("*")
      .eq("lead_id", viewer.lead.id)
      .order("date", { ascending: true })
      .order("time", { ascending: true }),
    admin
      .from("lead_files")
      .select("id, file_name, file_url, content_type, created_at, uploaded_by")
      .eq("lead_id", viewer.lead.id)
      .order("created_at", { ascending: false }),
    admin
      .from("sms_messages")
      .select("*")
      .eq("lead_id", viewer.lead.id)
      .order("created_at", { ascending: true }),
    admin
      .from("company_profile")
      .select("name, phone, logo_url")
      .eq("company_id", viewer.companyId)
      .maybeSingle(),
    admin.from("profiles").select("id, name, email, phone"),
  ]);

  const companyRow = company as { name: string | null; phone: string | null; logo_url: string | null } | null;

  return (
    <PortalHome
      lead={viewer.lead}
      events={(events as Event[]) ?? []}
      files={(files as PortalFile[]) ?? []}
      messages={(messages as SmsMessage[]) ?? []}
      reps={(reps as Profile[]) ?? []}
      companyName={companyRow?.name || "Your Contractor"}
      companyPhone={companyRow?.phone || null}
      companyLogo={companyRow?.logo_url || null}
    />
  );
}
