"use server";

import { getCompanyZone } from "@/lib/data/company-today";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { selectAll } from "@/lib/data/select-all";
import { getBoughtListKeysCached } from "@/lib/data/company-chrome";
import {
  briefEarliestStart,
  briefNumbers,
  type BriefAttention,
  type BriefBook,
  type BriefBreakdown,
  type BriefPeriod,
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
  // The furthest back any period looks.
  const readFrom = briefEarliestStart(now, zone);

  const [
    boughtKeys,
    { data: company },
    leads,
    events,
    calls,
    texts,
    tasks,
    { data: members },
  ] = await Promise.all([
    getBoughtListKeysCached(companyId),
    supabase.from("company_profile").select("name").eq("company_id", companyId).maybeSingle(),
    // selectAll: every figure on the brief is a sum over this, and a
    // bare select stops at 1000. On 1520 leads the morning brief was
    // reporting two thirds of the business as though it were all of it.
    selectAll<BriefBook["leads"][number]>((rangeFrom, rangeTo) =>
      supabase
        .from("leads")
        .select(
          "id, created_at, stage, stage_key, value, won_at, source, refund_status, refund_requested_at, has_appt"
        )
        .eq("company_id", companyId)
        .range(rangeFrom, rangeTo)
    ),
    // Same cap, same shape: "1000 APPOINTMENTS BOOKED" on a tenant with
    // 1,100 events was this query's bare select, not the real count.
    selectAll<BriefBook["events"][number]>((rangeFrom, rangeTo) =>
      supabase
        .from("events")
        .select("id, created_at, date, status, assigned_to, customer_confirmed, rain_alert_pop")
        .eq("company_id", companyId)
        .range(rangeFrom, rangeTo)
    ),
    // Calls and texts had the same bare select: past 1000 of either in
    // total, the counts were taken over whichever 1000 came back. Only
    // what the periods cover is read, paged, and in id order so the
    // pages don't overlap.
    selectAll<BriefBook["calls"][number]>(
      (rangeFrom, rangeTo) =>
        supabase
          .from("call_logs")
          .select("id, created_at, duration_seconds, rep_id")
          .eq("company_id", companyId)
          .gte("created_at", readFrom)
          .order("id")
          .range(rangeFrom, rangeTo)
    ),
    selectAll<BriefBook["texts"][number]>((rangeFrom, rangeTo) =>
      supabase
        .from("sms_messages")
        .select("id, created_at, direction")
        .eq("company_id", companyId)
        .gte("created_at", readFrom)
        .order("id")
        .range(rangeFrom, rangeTo)
    ),
    selectAll<BriefBook["tasks"][number]>(
      (rangeFrom, rangeTo) =>
        supabase
          .from("lead_tasks")
          .select("id, lead_id, due_date, completed_at")
          .eq("company_id", companyId)
          .range(rangeFrom, rangeTo)
    ),
    supabase.from("profiles").select("id, name, email"),
  ]);

  const memberRows = (members ?? []) as { id: string; name: string | null; email: string | null }[];
  const nameById = new Map(memberRows.map((m) => [m.id, m.name || m.email || "Unknown"]));
  const numbers = briefNumbers({ leads, events, calls, texts, tasks }, now, zone, boughtKeys, nameById);

  return {
    brief: {
      companyName: (company as { name: string | null } | null)?.name || "Your Company",
      generatedAt: new Date().toISOString(),
      ...numbers,
    },
  };
}
