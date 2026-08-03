import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import type { Lead, SmsMessage } from "@/lib/data/types";
import { TextReportsView } from "./text-reports-view";

export default async function TextReportsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const companyId = profile?.company_id ?? "";

  const [{ data: messages }, { data: leads }] = await Promise.all([
    supabase
      .from("sms_messages")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    supabase.from("leads").select("*").eq("company_id", companyId),
  ]);

  return (
    <TextReportsView
      messages={(messages as SmsMessage[]) ?? []}
      leads={(leads as Lead[]) ?? []}
    />
  );
}
