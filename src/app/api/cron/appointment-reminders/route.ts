import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/cron-env";
import { sendTwilioSms } from "@/lib/twilio-env";
import { getTwilioForCompany, type CompanyTwilio } from "@/lib/twilio-company";
import { nowInZone, parseNaiveDateTime } from "@/lib/timezone";
import {
  TIMEZONE_IANA,
  formatTimeRange,
  leadDisplayName,
  mapsUrl,
  type CompanyProfile,
  type Lead,
} from "@/lib/data/types";

// Advance notice window, in hours before the appointment. The lower
// bound leaves the hour-before reminder its own job; the upper bound is
// the evening before a next-day appointment.
const ADVANCE_MIN_HOURS = 2;
const ADVANCE_MAX_HOURS = 20;

type EventRow = {
  id: string;
  date: string;
  time: string | null;
  end_time: string | null;
  status: string;
  event_type: string;
  lead_id: string | null;
  assigned_to: string | null;
  notes: string | null;
  reminder_night_before_sent_at: string | null;
  reminder_hour_before_sent_at: string | null;
};

function buildBody(
  kind: "advance" | "hour",
  event: EventRow,
  lead: Lead,
  todayDate: string
): string {
  // ASCII hyphen: the en dash would push this SMS out of GSM-7.
  const timeLabel = formatTimeRange(event.time, event.end_time, "12h", "-");
  // The day word is derived, not assumed. The advance notice used to be
  // hard-coded to "tomorrow" because it could only ever send the evening
  // before; now that it sends whenever a run comes round, it has to say
  // which day it actually means.
  const dayWord = event.date === todayDate ? "today" : "tomorrow";
  const whenLabel =
    kind === "advance"
      ? `${dayWord}${timeLabel ? ` at ${timeLabel}` : ""}`
      : `in about an hour${timeLabel ? ` (${timeLabel})` : ""}`;
  const lines = [
    `Reminder: ${event.event_type} appointment with ${leadDisplayName(lead)} ${whenLabel}.`,
  ];
  if (lead.address) lines.push(`📍 ${mapsUrl(lead.address)}`);
  if (event.notes) lines.push(`Notes: ${event.notes}`);
  return lines.join("\n");
}

async function processCompany(
  admin: ReturnType<typeof createAdminClient>,
  twilioEnv: CompanyTwilio,
  company: Pick<CompanyProfile, "company_id" | "timezone">
): Promise<{ checked: number; sent: number }> {
  const ianaZone = TIMEZONE_IANA[company.timezone] ?? "America/Los_Angeles";
  const nowNaive = nowInZone(ianaZone);

  const todayDate = nowNaive.toISOString().slice(0, 10);
  const tomorrow = new Date(nowNaive.getTime() + 86400000);
  const tomorrowDate = tomorrow.toISOString().slice(0, 10);

  const { data: candidates } = await admin
    .from("events")
    .select(
      "id, date, time, end_time, status, event_type, lead_id, assigned_to, notes, reminder_night_before_sent_at, reminder_hour_before_sent_at"
    )
    .eq("company_id", company.company_id)
    .in("status", ["New", "Confirmed"])
    .not("lead_id", "is", null)
    .not("assigned_to", "is", null)
    .gte("date", todayDate)
    .lte("date", tomorrowDate)
    .or("reminder_night_before_sent_at.is.null,reminder_hour_before_sent_at.is.null");

  const rows = (candidates as EventRow[] | null) ?? [];
  if (rows.length === 0) return { checked: 0, sent: 0 };

  const leadIds = [...new Set(rows.map((r) => r.lead_id!))];
  const repIds = [...new Set(rows.map((r) => r.assigned_to!))];
  const [{ data: leads }, { data: reps }] = await Promise.all([
    admin.from("leads").select("*").eq("company_id", company.company_id).in("id", leadIds),
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

    // Advance notice: sent once, any time from the evening before up to
    // ~2 hours out. It used to require the run to land between 6pm and
    // midnight on the day before -- a six-hour slot that the scheduler
    // never actually hit, so this reminder had never fired once in the
    // life of the app. Driven by time-until-appointment instead, so any
    // run in a wide window does it.
    const hoursUntilStart = (start.getTime() - nowNaive.getTime()) / 3600000;
    if (
      !row.reminder_night_before_sent_at &&
      hoursUntilStart > ADVANCE_MIN_HOURS &&
      hoursUntilStart <= ADVANCE_MAX_HOURS
    ) {
      const result = await sendTwilioSms(
        repPhone,
        buildBody("advance", row, lead, todayDate),
        twilioEnv
      );
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
        const result = await sendTwilioSms(repPhone, buildBody("hour", row, lead, todayDate), twilioEnv);
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

  return { checked: rows.length, sent };
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
  // timezone and only ever sees its own events/leads.
  const admin = createAdminClient();
  const { data: companies } = await admin.from("company_profile").select("company_id, timezone");
  const companyRows = (companies as Pick<CompanyProfile, "company_id" | "timezone">[] | null) ?? [];

  let checked = 0;
  let sent = 0;
  let skipped = 0;
  for (const company of companyRows) {
    // Resolved per company: each texts from its own number. One company
    // without Twilio is skipped rather than aborting the run, so a
    // half-configured tenant cannot stop everybody else's reminders.
    const twilioEnv = await getTwilioForCompany(company.company_id);
    if (!twilioEnv) {
      skipped += 1;
      continue;
    }
    const result = await processCompany(admin, twilioEnv, company);
    checked += result.checked;
    sent += result.sent;
  }

  return NextResponse.json({ companies: companyRows.length, checked, sent, skipped });
}
