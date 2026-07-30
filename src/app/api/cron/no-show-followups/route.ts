import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/cron-env";
import { nowInZone, parseNaiveDateTime } from "@/lib/timezone";
import { TIMEZONE_IANA, type CompanyProfile } from "@/lib/data/types";

type CompanyRow = Pick<
  CompanyProfile,
  "company_id" | "timezone" | "no_show_followup_enabled" | "no_show_grace_minutes" | "no_show_lookback_hours"
>;

async function processCompany(
  admin: ReturnType<typeof createAdminClient>,
  company: CompanyRow
): Promise<{ checked: number; flagged: number }> {
  if (!company.no_show_followup_enabled) return { checked: 0, flagged: 0 };

  const ianaZone = TIMEZONE_IANA[company.timezone] ?? "America/Los_Angeles";
  const nowNaive = nowInZone(ianaZone);
  const cutoffLate = new Date(nowNaive.getTime() - company.no_show_grace_minutes * 60000);
  const cutoffOld = new Date(nowNaive.getTime() - company.no_show_lookback_hours * 3600000);

  const lookbackDate = cutoffOld.toISOString().slice(0, 10);
  const todayDate = nowNaive.toISOString().slice(0, 10);

  const { data: candidates } = await admin
    .from("events")
    .select("id, date, time, status, lead_id, assigned_to, title")
    .eq("company_id", company.company_id)
    .in("status", ["New", "Confirmed"])
    .is("followup_flagged_at", null)
    .gte("date", lookbackDate)
    .lte("date", todayDate);

  const rows =
    (candidates as
      | {
          id: string;
          date: string;
          time: string | null;
          status: string;
          lead_id: string | null;
          assigned_to: string | null;
          title: string | null;
        }[]
      | null) ?? [];

  let flagged = 0;
  for (const row of rows) {
    const start = parseNaiveDateTime(row.date, row.time);
    if (start > cutoffLate || start < cutoffOld) continue;

    if (row.lead_id) {
      await admin.from("lead_tasks").insert({
        lead_id: row.lead_id,
        title: `Follow up: no outcome set for "${row.title || "appointment"}" on ${row.date}`,
        due_date: todayDate,
        assigned_to: row.assigned_to,
        company_id: company.company_id,
      });
    }
    await admin
      .from("events")
      .update({ followup_flagged_at: new Date().toISOString() })
      .eq("id", row.id);
    flagged += 1;
  }

  return { checked: rows.length, flagged };
}

export async function POST(req: NextRequest) {
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // No session here (cron) -- loop every company so each uses its own
  // timezone/settings and only ever touches its own events/tasks.
  const admin = createAdminClient();
  const { data: companies } = await admin
    .from("company_profile")
    .select("company_id, timezone, no_show_followup_enabled, no_show_grace_minutes, no_show_lookback_hours");
  const companyRows = (companies as CompanyRow[] | null) ?? [];

  let checked = 0;
  let flagged = 0;
  for (const company of companyRows) {
    const result = await processCompany(admin, company);
    checked += result.checked;
    flagged += result.flagged;
  }

  return NextResponse.json({ companies: companyRows.length, checked, flagged });
}
