import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { leadsLiteForMessages } from "@/lib/data/lead-lite";
import { addDays } from "@/lib/schedule-window";
import {
  TEXT_REPORT_COLUMNS,
  parseTextReportQuery,
  textReportServerWindow,
  type TextReportRow,
} from "@/lib/text-reports-window";
import { TextReportsView } from "./text-reports-view";

export default async function TextReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const query = parseTextReportQuery(await searchParams);
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const companyId = profile?.company_id ?? "";

  // Only the period in the address (DECISIONS #146), and only the columns
  // the report uses -- this page used to read every text the company ever
  // sent or received. Every text in the period still comes (selectAll,
  // where a bare select stopped at PostgREST's 1000-row ceiling in
  // silence), so the numbers count them all.
  const bounds = textReportServerWindow(query, new Date().toISOString().slice(0, 10));
  const messages = await selectAll<TextReportRow>((f, t) => {
    let texts = supabase.from("sms_messages").select(TEXT_REPORT_COLUMNS).eq("company_id", companyId);
    if (bounds.lo) texts = texts.gte("created_at", bounds.lo);
    if (bounds.hi) texts = texts.lt("created_at", addDays(bounds.hi, 1));
    return texts
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(f, t);
  });

  // Only the contacts these texts reference -- by id, or by phone for
  // texts never linked to a lead. The whole book used to ride along.
  const leads = await leadsLiteForMessages(supabase, companyId, messages);

  return <TextReportsView query={query} messages={messages} leads={leads} />;
}
