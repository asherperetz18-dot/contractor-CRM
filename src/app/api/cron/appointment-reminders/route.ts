import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/cron-env";
import { getTwilioEnv, sendTwilioSms } from "@/lib/twilio-env";
import { nowInZone, parseNaiveDateTime } from "@/lib/timezone";
import { TIMEZONE_IANA, leadDisplayName, mapsUrl, type CompanyProfile, type Lead } from "@/lib/data/types";

const NIGHT_BEFORE_HOUR = 18; // 6pm local time

type EventRow = {
  id: string;
  date: string;
  time: string | null;
  status: string;
  event_type: string;
  lead_id: string | null;
  assigned_to: string | null;
  notes: string | null;
  reminder_night_before_sent_at: string | null;
  reminder_hour_before_sent_at: string | null;
};

function buildBody(kind: "night" | "hour", event: EventRow, lead: Lead): string {
  const timeLabel = event.time
    ? new Date(`1970-01-01T${event.time.slice(0, 5)}:00`).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const whenLabel = kind === "night" ? `tomorrow${timeLabel ? ` at ${timeLabel}` : ""}` : `in about an hour${timeLabel ? ` (${timeLabel})` : ""}`;
  const lines = [
    `Reminder: ${event.event_type} appointment with ${leadDisplayName(lead)} ${whenLabel}.`,
  ];
  if (lead.address) lines.push(`📍 ${mapsUrl(lead.address)}`);
  if (event.notes) lines.push(`Notes: ${event.notes}`);
  return lines.join("\n");
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

  const twilioEnv = getTwilioEnv();
  if (!twilioEnv) {
    return NextResponse.json({ error: "Twilio not configured" }, { status: 500 });
  }

  const admin = createAdminClient();
  const { data: company } = await admin
    .from("company_profile")
    .select("timezone")
    .eq("id", 1)
    .single();
  const profile = company as Pick<CompanyProfile, "timezone"> | null;
  const ianaZone = TIMEZONE_IANA[profile?.timezone ?? ""] ?? "America/Los_Angeles";
  const nowNaive = nowInZone(ianaZone);

  const todayDate = nowNaive.toISOString().slice(0, 10);
  const tomorrow = new Date(nowNaive.getTime() + 86400000);
  const tomorrowDate = tomorrow.toISOString().slice(0, 10);

  const { data: candidates } = await admin
    .from("events")
    .select(
      "id, date, time, status, event_type, lead_id, assigned_to, notes, reminder_night_before_sent_at, reminder_hour_before_sent_at"
    )
    .in("status", ["New", "Confirmed"])
    .not("lead_id", "is", null)
    .not("assigned_to", "is", null)
    .gte("date", todayDate)
    .lte("date", tomorrowDate)
    .or("reminder_night_before_sent_at.is.null,reminder_hour_before_sent_at.is.null");

  const rows = (candidates as EventRow[] | null) ?? [];
  if (rows.length === 0) return NextResponse.json({ checked: 0, sent: 0 });

  const leadIds = [...new Set(rows.map((r) => r.lead_id!))];
  const repIds = [...new Set(rows.map((r) => r.assigned_to!))];
  const [{ data: leads }, { data: reps }] = await Promise.all([
    admin.from("leads").select("*").in("id", leadIds),
    admin.from("profiles").select("id, phone").in("id", repIds),
  ]);
  const leadById = new Map(((leads as Lead[]) ?? []).map((l) => [l.id, l]));
  const repPhoneById = new Map(
    ((reps as { id: string; phone: string | null }[]) ?? []).map((r) => [r.id, r.phone])
  );

  let sent = 0;
  for (const row of rows) {
    const lead = leadById.get(row.lead_id!);
    const repPhone = repPhoneById.get(row.assigned_to!);
    if (!lead || !repPhone) continue;

    const start = parseNaiveDateTime(row.date, row.time);

    if (
      row.date === tomorrowDate &&
      !row.reminder_night_before_sent_at &&
      nowNaive.getUTCHours() >= NIGHT_BEFORE_HOUR
    ) {
      const result = await sendTwilioSms(repPhone, buildBody("night", row, lead), twilioEnv);
      if (!result.error) {
        await admin
          .from("events")
          .update({ reminder_night_before_sent_at: new Date().toISOString() })
          .eq("id", row.id);
        sent += 1;
      }
      continue;
    }

    if (row.date === todayDate && !row.reminder_hour_before_sent_at) {
      const minutesUntilStart = (start.getTime() - nowNaive.getTime()) / 60000;
      if (minutesUntilStart > 0 && minutesUntilStart <= 60) {
        const result = await sendTwilioSms(repPhone, buildBody("hour", row, lead), twilioEnv);
        if (!result.error) {
          await admin
            .from("events")
            .update({ reminder_hour_before_sent_at: new Date().toISOString() })
            .eq("id", row.id);
          sent += 1;
        }
      }
    }
  }

  return NextResponse.json({ checked: rows.length, sent });
}
