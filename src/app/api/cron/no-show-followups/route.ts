import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/cron-env";
import { TIMEZONE_IANA, type CompanyProfile } from "@/lib/data/types";

function nowInZone(ianaZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ianaZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return new Date(
    Date.UTC(
      Number(get("year")),
      Number(get("month")) - 1,
      Number(get("day")),
      Number(get("hour")) % 24,
      Number(get("minute")),
      Number(get("second"))
    )
  );
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

  const admin = createAdminClient();
  const { data: company } = await admin
    .from("company_profile")
    .select("timezone, no_show_followup_enabled, no_show_grace_minutes, no_show_lookback_hours")
    .eq("id", 1)
    .single();
  const profile = company as Pick<
    CompanyProfile,
    "timezone" | "no_show_followup_enabled" | "no_show_grace_minutes" | "no_show_lookback_hours"
  > | null;

  if (!profile?.no_show_followup_enabled) {
    return NextResponse.json({ skipped: "disabled" });
  }

  const ianaZone = TIMEZONE_IANA[profile.timezone] ?? "America/Los_Angeles";
  const nowNaive = nowInZone(ianaZone);
  const cutoffLate = new Date(nowNaive.getTime() - profile.no_show_grace_minutes * 60000);
  const cutoffOld = new Date(nowNaive.getTime() - profile.no_show_lookback_hours * 3600000);

  const lookbackDate = cutoffOld.toISOString().slice(0, 10);
  const todayDate = nowNaive.toISOString().slice(0, 10);

  const { data: candidates } = await admin
    .from("events")
    .select("id, date, time, status, lead_id, assigned_to, title")
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
    const start = new Date(`${row.date}T${row.time || "00:00"}:00Z`);
    if (start > cutoffLate || start < cutoffOld) continue;

    if (row.lead_id) {
      await admin.from("lead_tasks").insert({
        lead_id: row.lead_id,
        title: `Follow up: no outcome set for "${row.title || "appointment"}" on ${row.date}`,
        due_date: todayDate,
        assigned_to: row.assigned_to,
      });
    }
    await admin
      .from("events")
      .update({ followup_flagged_at: new Date().toISOString() })
      .eq("id", row.id);
    flagged += 1;
  }

  return NextResponse.json({ checked: rows.length, flagged });
}
