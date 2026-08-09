import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/cron-env";
import { sendTwilioSms } from "@/lib/twilio-env";
import { getTwilioForCompany, type CompanyTwilio } from "@/lib/twilio-company";
import { nowInZone, parseNaiveDateTime } from "@/lib/timezone";
import { TIMEZONE_IANA, leadDisplayName, type CompanyProfile, type Lead } from "@/lib/data/types";

type TaskRow = {
  id: string;
  lead_id: string;
  title: string;
  due_date: string;
  due_time: string | null;
  assigned_to: string | null;
};

function buildBody(task: TaskRow, lead: Lead | undefined): string {
  const timeLabel = task.due_time
    ? new Date(`1970-01-01T${task.due_time.slice(0, 5)}:00`).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const who = lead ? ` for ${leadDisplayName(lead)}` : "";
  return `Reminder: task "${task.title}"${who} is due in about 2 hours${timeLabel ? ` (${timeLabel})` : ""}.`;
}

async function processCompany(
  admin: ReturnType<typeof createAdminClient>,
  twilioEnv: CompanyTwilio,
  company: Pick<CompanyProfile, "company_id" | "timezone">
): Promise<{ checked: number; sent: number }> {
  const ianaZone = TIMEZONE_IANA[company.timezone] ?? "America/Los_Angeles";
  const nowNaive = nowInZone(ianaZone);

  const todayDate = nowNaive.toISOString().slice(0, 10);
  const tomorrowDate = new Date(nowNaive.getTime() + 86400000).toISOString().slice(0, 10);

  const { data: candidates } = await admin
    .from("lead_tasks")
    .select("id, lead_id, title, due_date, due_time, assigned_to")
    .eq("company_id", company.company_id)
    .is("completed_at", null)
    .is("reminder_2h_sent_at", null)
    .not("due_time", "is", null)
    .not("assigned_to", "is", null)
    .gte("due_date", todayDate)
    .lte("due_date", tomorrowDate);

  const rows = (candidates as TaskRow[] | null) ?? [];
  if (rows.length === 0) return { checked: 0, sent: 0 };

  const leadIds = [...new Set(rows.map((r) => r.lead_id))];
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
    const repPhone = repPhoneById.get(row.assigned_to!);
    if (!repPhone) continue;

    const due = parseNaiveDateTime(row.due_date, row.due_time);
    const minutesUntilDue = (due.getTime() - nowNaive.getTime()) / 60000;
    if (minutesUntilDue <= 0 || minutesUntilDue > 120) continue;

    const result = await sendTwilioSms(repPhone, buildBody(row, leadById.get(row.lead_id)), twilioEnv);
    if (!result.error) {
      await admin
        .from("lead_tasks")
        .update({ reminder_2h_sent_at: new Date().toISOString() })
        .eq("id", row.id);
      sent += 1;
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
  // timezone and only ever sees its own tasks/leads.
  const admin = createAdminClient();
  const { data: companies } = await admin.from("company_profile").select("company_id, timezone");
  const companyRows = (companies as Pick<CompanyProfile, "company_id" | "timezone">[] | null) ?? [];

  let checked = 0;
  let sent = 0;
  let skipped = 0;
  for (const company of companyRows) {
    // One company without Twilio must not abort the whole run.
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
