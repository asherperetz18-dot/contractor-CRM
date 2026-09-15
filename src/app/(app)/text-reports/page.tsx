import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { leadsLiteForMessages } from "@/lib/data/lead-lite";
import type { SmsMessage } from "@/lib/data/types";
import { TextReportsView } from "./text-reports-view";

export default async function TextReportsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const companyId = profile?.company_id ?? "";

  // selectAll, where a bare select stopped at PostgREST's 1000-row
  // ceiling in silence -- this report was only ever counting the newest
  // thousand texts.
  const messages = await selectAll<SmsMessage>((f, t) =>
    supabase
      .from("sms_messages")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .range(f, t)
  );

  // Only the contacts these texts reference -- by id, or by phone for
  // texts never linked to a lead. The whole book used to ride along.
  const leads = await leadsLiteForMessages(supabase, companyId, messages);

  return (
    <TextReportsView
      messages={messages}
      leads={leads}
    />
  );
}
