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

  const [messages, leads, allReps] = await Promise.all([
    // selectAll, not a bare select: past 1000 lifetime messages the
    // ascending order + PostgREST's silent max-rows cap returned the
    // OLDEST thousand -- newest conversations missing entirely, which
    // the incoming-text badge would then contradict on every screen.
    selectAll<SmsMessage>((f, t) =>
      supabase
        .from("sms_messages")
        .select("*")
        .eq("company_id", companyId)
      // Rep-facing texts are excluded. They were landing here as
      // conversations keyed by the rep's phone, so a teammate appeared
      // in the list looking like a client -- and replying in that thread
      // sent the customer message straight to the rep.
      //
      // With one exception: a crew reply we could not tie to any
      // appointment. Those have no job page to appear on, so excluding
      // them here means they exist in the database and nowhere else. They
      // key by the rep's own phone rather than a lead, so they cannot
      // reappear inside a customer's thread -- which is what the
      // exclusion was protecting against.
        .or("channel.neq.rep,and(channel.eq.rep,lead_id.is.null,direction.eq.inbound)")
        .order("created_at", { ascending: true })
        .range(f, t)
    ),
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
