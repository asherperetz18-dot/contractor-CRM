import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { leadsLiteByIds, leadsLiteForMessages } from "@/lib/data/lead-lite";
import { canEditDispatch, type SmsMessage } from "@/lib/data/types";
import { ReplyInboxView } from "./reply-inbox-view";

export default async function ReplyInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string }>;
}) {
  const { leadId: targetLeadId } = await searchParams;
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);
  const companyId = profile?.company_id ?? "";

  const [messages, allReps] = await Promise.all([
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
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
  ]);
  const reps = allReps.filter((r) => r.phone);

  // Only the contacts these conversations reference -- by id, or by the
  // counterparty's phone for texts never linked to a lead -- plus the
  // lead a compose deep-link (?leadId=) targets, which may have no
  // messages yet. The whole book used to ride along for this lookup.
  const [messageLeads, targetLeads] = await Promise.all([
    leadsLiteForMessages(supabase, companyId, messages as SmsMessage[]),
    targetLeadId ? leadsLiteByIds(supabase, companyId, [targetLeadId]) : Promise.resolve([]),
  ]);
  const seen = new Set(messageLeads.map((l) => l.id));
  const leads = [...messageLeads, ...targetLeads.filter((l) => !seen.has(l.id))];

  return (
    <ReplyInboxView
      messages={(messages as SmsMessage[]) ?? []}
      leads={leads}
      reps={reps}
      canWrite={canWrite}
    />
  );
}
