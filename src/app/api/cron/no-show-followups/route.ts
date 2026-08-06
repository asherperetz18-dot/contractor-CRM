import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/cron-env";
import { getTwilioEnv, sendTwilioSms } from "@/lib/twilio-env";
import { nowInZone, parseNaiveDateTime } from "@/lib/timezone";
import {
  FOLLOW_UP_STAGE,
  TIMEZONE_IANA,
  formatTimeRange,
  hasAppointmentResult,
  type CompanyProfile,
  type EventStatus,
} from "@/lib/data/types";

// Local hour at which an appointment nobody logged a result for gives up
// waiting and moves the lead itself. Late enough that a rep who finishes
// at five still has the evening to do it properly.
const AUTO_MOVE_HOUR = 20;

// The only stage this automation will move a lead out of. If someone has
// already advanced the lead -- to Proposal Sent, or Won -- the appointment
// clearly did happen, and dragging it back into a follow-up bucket would
// destroy real sales information.
const MOVABLE_FROM_STAGE = "Appointment Scheduled";

type CompanyRow = Pick<
  CompanyProfile,
  | "company_id"
  | "timezone"
  | "no_show_followup_enabled"
  | "no_show_grace_minutes"
  | "no_show_lookback_hours"
>;

type EventRow = {
  id: string;
  date: string;
  time: string | null;
  end_time: string | null;
  status: EventStatus;
  lead_id: string | null;
  assigned_to: string | null;
  title: string | null;
  followup_flagged_at: string | null;
  result_reminder_sent_at: string | null;
  followup_moved_at: string | null;
};

function reminderBody(row: EventRow, leadName: string): string {
  // ASCII hyphen only: an en dash would push this out of GSM-7 and double
  // the segment count (see formatTimeRange).
  const when = formatTimeRange(row.time, row.end_time, "12h", "-").toLowerCase();
  return [
    `No result logged yet for ${row.title || "your appointment"}${leadName ? ` with ${leadName}` : ""}`,
    `${row.date}${when ? ` at ${when}` : ""}.`,
    "Open it in the CRM and set Showed, No-show or Cancelled.",
  ].join(" ");
}

async function processCompany(
  admin: ReturnType<typeof createAdminClient>,
  twilioEnv: ReturnType<typeof getTwilioEnv>,
  company: CompanyRow
): Promise<{ checked: number; flagged: number; texted: number; moved: number }> {
  const empty = { checked: 0, flagged: 0, texted: 0, moved: 0 };
  if (!company.no_show_followup_enabled) return empty;

  const ianaZone = TIMEZONE_IANA[company.timezone] ?? "America/Los_Angeles";
  const nowNaive = nowInZone(ianaZone);
  const cutoffLate = new Date(nowNaive.getTime() - company.no_show_grace_minutes * 60000);
  const cutoffOld = new Date(nowNaive.getTime() - company.no_show_lookback_hours * 3600000);

  const lookbackDate = cutoffOld.toISOString().slice(0, 10);
  const todayDate = nowNaive.toISOString().slice(0, 10);

  // No longer filtered on followup_flagged_at: an event flagged at the
  // one-hour mark still needs looking at again this evening for the stage
  // move. Each of the three actions is guarded by its own timestamp.
  const { data: candidates } = await admin
    .from("events")
    .select(
      "id, date, time, end_time, status, lead_id, assigned_to, title, followup_flagged_at, result_reminder_sent_at, followup_moved_at"
    )
    .eq("company_id", company.company_id)
    .in("status", ["New", "Confirmed"])
    .gte("date", lookbackDate)
    .lte("date", todayDate);

  const rows = (candidates as EventRow[] | null) ?? [];
  const stamp = new Date().toISOString();
  let flagged = 0;
  let texted = 0;
  let moved = 0;

  for (const row of rows) {
    if (hasAppointmentResult(row.status)) continue;

    // Appointments run to their end time where one was recorded, so a
    // 9-to-5 job isn't chased at 10am.
    const start = parseNaiveDateTime(row.date, row.end_time ?? row.time);
    if (start > cutoffLate || start < cutoffOld) continue;

    // 1. A task on the lead, once.
    if (!row.followup_flagged_at && row.lead_id) {
      await admin.from("lead_tasks").insert({
        lead_id: row.lead_id,
        title: `Follow up: no outcome set for "${row.title || "appointment"}" on ${row.date}`,
        due_date: todayDate,
        assigned_to: row.assigned_to,
        company_id: company.company_id,
      });
      await admin.from("events").update({ followup_flagged_at: stamp }).eq("id", row.id);
      flagged += 1;
    }

    // 2. One text to the rep who owns it. Appointments flagged before this
    // feature existed have a null result_reminder_sent_at as well, so they
    // would all fire at once -- what stops that is the lookback window
    // above, which already skipped anything older than a few hours.
    if (!row.result_reminder_sent_at && row.assigned_to && twilioEnv) {
      const { data: rep } = await admin
        .from("profiles")
        .select("phone")
        .eq("id", row.assigned_to)
        .single();
      const repPhone = (rep as { phone: string | null } | null)?.phone;
      if (repPhone) {
        let leadName = "";
        if (row.lead_id) {
          const { data: lead } = await admin
            .from("leads")
            .select("first_name, last_name")
            .eq("id", row.lead_id)
            .single();
          const l = lead as { first_name: string | null; last_name: string | null } | null;
          leadName = `${l?.first_name ?? ""} ${l?.last_name ?? ""}`.trim();
        }
        const result = await sendTwilioSms(repPhone, reminderBody(row, leadName), twilioEnv);
        if (!result.error) {
          await admin.from("events").update({ result_reminder_sent_at: stamp }).eq("id", row.id);
          texted += 1;
        }
      }
    }

    // 3. The appointment's day is over and still nothing: move the lead so
    // it doesn't go cold.
    //
    // Deliberately "that day has ended", not "it is currently after 8pm".
    // The clock version only fired if a run happened to land in the four
    // hours before midnight, and GitHub's scheduler drops runs under load
    // -- a missed window meant the appointment aged out of the lookback
    // and was never moved at all. This still gives the rep until the end
    // of the day, and catches up on the next run whenever that is.
    const dayIsOver =
      row.date < todayDate ||
      (row.date === todayDate && nowNaive.getUTCHours() >= AUTO_MOVE_HOUR);
    if (dayIsOver && !row.followup_moved_at && row.lead_id) {
      const { data: lead } = await admin
        .from("leads")
        .select("stage")
        .eq("id", row.lead_id)
        .single();
      const stage = (lead as { stage: string } | null)?.stage;

      if (stage === MOVABLE_FROM_STAGE) {
        // Only into a stage the company actually has. An admin who renamed
        // or deleted it gets no move, rather than a broken stage value.
        const { data: target } = await admin
          .from("pipeline_stages")
          .select("name")
          .eq("company_id", company.company_id)
          .eq("name", FOLLOW_UP_STAGE)
          .maybeSingle();

        if (target) {
          await admin.from("leads").update({ stage: FOLLOW_UP_STAGE }).eq("id", row.lead_id);
          await admin.from("lead_notes").insert({
            lead_id: row.lead_id,
            body: `Moved to ${FOLLOW_UP_STAGE} automatically - the ${row.date} appointment ended with no result recorded.`,
            // No author_id: this wasn't a person, and attributing it to
            // one would put words in their mouth on the lead's timeline.
            event_id: row.id,
            company_id: company.company_id,
          });
          moved += 1;
        }
      }
      // Stamped either way: a lead the rep already advanced shouldn't be
      // re-examined every 15 minutes for the rest of the lookback window.
      await admin.from("events").update({ followup_moved_at: stamp }).eq("id", row.id);
    }
  }

  return { checked: rows.length, flagged, texted, moved };
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

  // Texting is best-effort: if Twilio isn't configured, the tasks and the
  // stage moves still need to happen.
  const twilioEnv = getTwilioEnv();

  // No session here (cron) -- loop every company so each uses its own
  // timezone/settings and only ever touches its own events/tasks.
  const admin = createAdminClient();
  const { data: companies } = await admin
    .from("company_profile")
    .select(
      "company_id, timezone, no_show_followup_enabled, no_show_grace_minutes, no_show_lookback_hours"
    );
  const companyRows = (companies as CompanyRow[] | null) ?? [];

  let checked = 0;
  let flagged = 0;
  let texted = 0;
  let moved = 0;
  for (const company of companyRows) {
    const result = await processCompany(admin, twilioEnv, company);
    checked += result.checked;
    flagged += result.flagged;
    texted += result.texted;
    moved += result.moved;
  }

  return NextResponse.json({ companies: companyRows.length, checked, flagged, texted, moved });
}
