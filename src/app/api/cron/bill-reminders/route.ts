import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refuseCronCaller } from "@/lib/cron-auth";
import { withRouteObservability } from "@/lib/observability/observe";
import { runForEachCompany, runSummary } from "@/lib/cron/run-companies";
import { runCompanyReminders, type ReminderCompany } from "@/lib/bill-reminders-run";

/**
 * Automatic payment reminders (DECISIONS #152), every hour. Only the
 * companies that switched them on; each sends between 9am and 6pm on its
 * own clock, so the hour that's right for each comes round once a day.
 */
async function handlePost(req: NextRequest) {
  // The database's scheduler or a CRON_SECRET holder (DECISIONS #140).
  const refused = await refuseCronCaller(req);
  if (refused) return refused;

  const admin = createAdminClient();
  // An error (0208 not run) reads as nobody switched on.
  const { data } = await admin
    .from("company_profile")
    .select("company_id, timezone, name, bill_reminder_channel")
    .eq("bill_reminders_enabled", true);
  const companyRows = (data as ReminderCompany[] | null) ?? [];

  let checked = 0;
  let sent = 0;
  // Each company in its own safety net (DECISIONS #126); locked ones are paused.
  const run = await runForEachCompany("api.cron.bill-reminders", companyRows, (c) => c.company_id, async (company) => {
    const result = await runCompanyReminders(admin, company);
    checked += result.checked;
    sent += result.sent;
  });

  return NextResponse.json({ companies: companyRows.length, checked, sent, ...runSummary(run) });
}

// Room for every company's turn (runForEachCompany stops starting new
// ones at CRON_BUDGET_MS, before this limit).
export const maxDuration = 300;

export const POST = withRouteObservability("api.cron.bill-reminders", handlePost);
