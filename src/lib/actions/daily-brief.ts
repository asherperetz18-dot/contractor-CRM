"use server";

import { getCompanyZone } from "@/lib/data/company-today";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { selectAll } from "@/lib/data/select-all";
import { getBoughtListKeysCached } from "@/lib/data/company-chrome";
import {
  briefNumbers,
  briefReadWindow,
  type BriefAttention,
  type BriefBreakdown,
  type BriefPeriod,
  type BriefRows,
  type BriefStats,
} from "@/lib/daily-brief";

export type DailyBrief = {
  companyName: string;
  generatedAt: string;
  periods: Record<BriefPeriod, BriefStats>;
  attention: BriefAttention;
  // One per period, so the lower tables follow the chips too.
  breakdown: Record<BriefPeriod, BriefBreakdown>;
};

/**
 * Numbers for the admin daily brief.
 *
 * Admin-gated on the server, not just in the UI -- this aggregates the
 * whole company's performance, and a server action is reachable directly.
 */
export async function getDailyBrief(): Promise<{ error?: string; brief?: DailyBrief }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "The daily brief is for admins." };

  const supabase = await createClient();
  const companyId = profile.company_id;
  const zone = await getCompanyZone();
  const now = new Date();
  const read = briefReadWindow(now, zone);

  // Each read goes only as far as a figure needs. The leads, appointments
  // and tasks used to be read in full -- every one the company ever had,
  // some 79 pages of 1,000 at 79,000 contacts -- each time the brief
  // opened. Every read is still paged (a bare select stops at 1000 rows
  // without a word), in id order so the pages don't overlap.
  const [
    boughtKeys,
    { data: company },
    newLeads,
    wonLeads,
    openRefunds,
    bookedEvents,
    datedEvents,
    calls,
    texts,
    doneTasks,
    overdueTasks,
    { data: members },
  ] = await Promise.all([
    getBoughtListKeysCached(companyId),
    supabase.from("company_profile").select("name").eq("company_id", companyId).maybeSingle(),
    selectAll<BriefRows["newLeads"][number]>((rangeFrom, rangeTo) =>
      supabase
        .from("leads")
        .select("id, created_at, source")
        .eq("company_id", companyId)
        .gte("created_at", read.since)
        .order("id")
        .range(rangeFrom, rangeTo)
    ),
    // Won in the window, however long ago they came in.
    selectAll<BriefRows["wonLeads"][number]>((rangeFrom, rangeTo) =>
      supabase
        .from("leads")
        .select("id, won_at, value")
        .eq("company_id", companyId)
        .gte("won_at", read.since)
        .order("id")
        .range(rangeFrom, rangeTo)
    ),
    selectAll<BriefRows["openRefunds"][number]>((rangeFrom, rangeTo) =>
      supabase
        .from("leads")
        .select("id, refund_requested_at")
        .eq("company_id", companyId)
        .eq("refund_status", "Requested")
        .order("id")
        .range(rangeFrom, rangeTo)
    ),
    selectAll<BriefRows["bookedEvents"][number]>((rangeFrom, rangeTo) =>
      supabase
        .from("events")
        .select("id, created_at, assigned_to")
        .eq("company_id", companyId)
        .gte("created_at", read.since)
        .order("id")
        .range(rangeFrom, rangeTo)
    ),
    // Dated in the window, up to a week ahead for the unconfirmed and
    // rain warnings.
    selectAll<BriefRows["datedEvents"][number]>((rangeFrom, rangeTo) =>
      supabase
        .from("events")
        .select("id, date, status, customer_confirmed, rain_alert_pop")
        .eq("company_id", companyId)
        .gte("date", read.sinceDay)
        .lte("date", read.weekAhead)
        .order("id")
        .range(rangeFrom, rangeTo)
    ),
    selectAll<BriefRows["calls"][number]>((rangeFrom, rangeTo) =>
      supabase
        .from("call_logs")
        .select("id, created_at, duration_seconds, rep_id")
        .eq("company_id", companyId)
        .gte("created_at", read.since)
        .order("id")
        .range(rangeFrom, rangeTo)
    ),
    selectAll<BriefRows["texts"][number]>((rangeFrom, rangeTo) =>
      supabase
        .from("sms_messages")
        .select("id, created_at, direction")
        .eq("company_id", companyId)
        .gte("created_at", read.since)
        .order("id")
        .range(rangeFrom, rangeTo)
    ),
    selectAll<BriefRows["doneTasks"][number]>((rangeFrom, rangeTo) =>
      supabase
        .from("lead_tasks")
        .select("id, completed_at")
        .eq("company_id", companyId)
        .gte("completed_at", read.since)
        .order("id")
        .range(rangeFrom, rangeTo)
    ),
    // With its lead's stage, so one on a closed lead is skipped without
    // reading the leads.
    selectAll<BriefRows["overdueTasks"][number]>((rangeFrom, rangeTo) =>
      supabase
        .from("lead_tasks")
        .select("id, leads(stage_key)")
        .eq("company_id", companyId)
        .is("completed_at", null)
        .lt("due_date", read.today)
        .order("id")
        .range(rangeFrom, rangeTo)
    ),
    supabase.from("profiles").select("id, name, email"),
  ]);

  const memberRows = (members ?? []) as { id: string; name: string | null; email: string | null }[];
  const nameById = new Map(memberRows.map((m) => [m.id, m.name || m.email || "Unknown"]));
  const numbers = briefNumbers(
    { newLeads, wonLeads, openRefunds, bookedEvents, datedEvents, calls, texts, doneTasks, overdueTasks },
    now,
    zone,
    boughtKeys,
    nameById
  );

  return {
    brief: {
      companyName: (company as { name: string | null } | null)?.name || "Your Company",
      generatedAt: new Date().toISOString(),
      ...numbers,
    },
  };
}
