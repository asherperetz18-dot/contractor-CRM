import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canEditDispatch, type Lead, type SmsMessage } from "@/lib/data/types";
import { ReplyInboxView } from "./reply-inbox-view";

export default async function ReplyInboxPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);

  const [{ data: messages }, { data: leads }] = await Promise.all([
    supabase
      .from("sms_messages")
      .select("*")
      .order("created_at", { ascending: true }),
    supabase.from("leads").select("*"),
  ]);

  return (
    <ReplyInboxView
      messages={(messages as SmsMessage[]) ?? []}
      leads={(leads as Lead[]) ?? []}
      canWrite={canWrite}
    />
  );
}
