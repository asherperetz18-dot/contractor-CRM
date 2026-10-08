import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refuseCronCaller } from "@/lib/cron-auth";
import { withRouteObservability } from "@/lib/observability/observe";
import { runForEachCompany, runSummary } from "@/lib/cron/run-companies";
import { syncCompanyBills } from "@/lib/quickbooks/bill-sync-run";

/**
 * Every five minutes (0222, DECISIONS #173): each company that turned on
 * "Send bills to QuickBooks" has its new and changed bills and bill
 * payments sent to its QuickBooks. One company's QuickBooks refusing or
 * timing out never stops the others; locked and closed companies are
 * skipped.
 */
async function handlePost(req: NextRequest) {
  // The database's scheduler or a CRON_SECRET holder (DECISIONS #140).
  const refused = await refuseCronCaller(req);
  if (refused) return refused;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("quickbooks_connections")
    .select("company_id")
    .eq("send_bills", true)
    .not("realm_id", "is", null)
    .is("disconnected_at", null);
  // Before 0222 has run there's nobody to send for.
  if (error) return NextResponse.json({ companies: 0, skipped: error.message });
  const companyRows = (data as { company_id: string }[] | null) ?? [];

  const started = Date.now();
  const totals = { companies: companyRows.length, sent: 0, changed: 0, removed: 0, waiting: 0, failed: 0, busy: 0, stopped: 0 };
  const run = await runForEachCompany("api.cron.quickbooks-sync", companyRows, (c) => c.company_id, async (company) => {
    // A company's share of the run: never more than 90 seconds, so one
    // company with a long backlog can't crowd out the rest.
    const left = 230_000 - (Date.now() - started);
    const s = await syncCompanyBills(admin, company.company_id, { budgetMs: Math.max(10_000, Math.min(90_000, left)) });
    totals.sent += s.sent;
    totals.changed += s.changed;
    totals.removed += s.removed;
    totals.waiting += s.waiting;
    totals.failed += s.failed;
    if (s.busy) totals.busy += 1;
    if (s.error) totals.stopped += 1;
  });
  return NextResponse.json({ ...totals, ...runSummary(run) });
}

// Room for every company's turn (runForEachCompany stops starting new
// ones at CRON_BUDGET_MS, before this limit).
export const maxDuration = 300;

export const POST = withRouteObservability("api.cron.quickbooks-sync", handlePost);
