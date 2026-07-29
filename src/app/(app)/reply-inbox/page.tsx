import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { canEditDispatch, type Lead, type SmsMessage } from "@/lib/data/types";
import { ReplyInboxView } from "./reply-inbox-view";

export default async function ReplyInboxPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);
  const companyId = profile?.company_id ?? "";

  const [{ data: messages }, { data: leads }, allReps] = await Promise.all([
    supabase
      .from("sms_messages")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true }),
    supabase.from("leads").select("*").eq("company_id", companyId),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
  ]);
  const reps = allReps.filter((r) => r.phone);

  return (
    <ReplyInboxView
      messages={(messages as SmsMessage[]) ?? []}
      leads={(leads as Lead[]) ?? []}
      reps={reps}
      canWrite={canWrite}
    />
  );
}
