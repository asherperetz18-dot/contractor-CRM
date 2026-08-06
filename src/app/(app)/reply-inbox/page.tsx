import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { canEditDispatch, type Lead, type SmsMessage } from "@/lib/data/types";
import { ReplyInboxView } from "./reply-inbox-view";

export default async function ReplyInboxPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);
  const companyId = profile?.company_id ?? "";

  const [{ data: messages }, leads, allReps] = await Promise.all([
    supabase
      .from("sms_messages")
      .select("*")
      .eq("company_id", companyId)
      // Rep-facing texts are excluded. They were landing here as
      // conversations keyed by the rep's phone, so a teammate appeared
      // in the list looking like a client -- and replying in that thread
      // sent the customer message straight to the rep.
      .neq("channel", "rep")
      .order("created_at", { ascending: true }),
    selectAll<Lead>((f, t) =>
      supabase.from("leads").select("*").eq("company_id", companyId).range(f, t)
    ),
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
