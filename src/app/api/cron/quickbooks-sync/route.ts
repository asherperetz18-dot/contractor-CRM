import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refuseCronCaller } from "@/lib/cron-auth";
import { withRouteObservability } from "@/lib/observability/observe";
import { runForEachCompany, runSummary } from "@/lib/cron/run-companies";
import { syncCompanyBills } from "@/lib/quickbooks/bill-sync-run";
import { syncCompanyInvoices } from "@/lib/quickbooks/invoice-sync-run";
import { syncCompanyCosts } from "@/lib/quickbooks/cost-sync-run";
import { fetchUntil } from "@/lib/quickbooks/api";

/**
 * Every five minutes (0222, DECISIONS #173, #184, #199): each company that
 * turned on "Send invoices to QuickBooks" has its new and changed invoices,
 * customer payments, credits and refunds sent first (adding each job, so
 * its bills and lender fees can be tagged with it), then, if it sends
 * bills, its bills and bill payments, then, if it sends job costs, its
 * lender fees as expenses. One company's QuickBooks refusing or timing out
 * never stops the others; locked and closed companies are skipped.
 */
async function handlePost(req: NextRequest) {
  // The database's scheduler or a CRON_SECRET holder (DECISIONS #140).
  const refused = await refuseCronCaller(req);
  if (refused) return refused;

  const admin = createAdminClient();
  type Row = { company_id: string; send_bills: boolean | null; send_invoices?: boolean | null; send_costs?: boolean | null };
  const all = await admin
    .from("quickbooks_connections")
    .select("company_id, send_bills, send_invoices, send_costs")
    .or("send_bills.eq.true,send_invoices.eq.true,send_costs.eq.true")
    .not("realm_id", "is", null)
    .is("disconnected_at", null);
  // Before 0230 there's no job-costs switch: bills and invoices.
  const both = all.error
    ? await admin
        .from("quickbooks_connections")
        .select("company_id, send_bills, send_invoices")
        .or("send_bills.eq.true,send_invoices.eq.true")
        .not("realm_id", "is", null)
        .is("disconnected_at", null)
    : all;
  // Before 0227 there's no invoices switch: bills only.
  const { data, error } = both.error
    ? await admin.from("quickbooks_connections").select("company_id, send_bills").eq("send_bills", true).not("realm_id", "is", null).is("disconnected_at", null)
    : both;
  // Before 0222 has run there's nobody to send for.
  if (error) return NextResponse.json({ companies: 0, skipped: error.message });
  const companyRows = (data as Row[] | null) ?? [];

  const started = Date.now();
  // Every QuickBooks call stops before the route's 300-second limit, whatever each company's share.
  const fetchImpl = fetchUntil(started + 285_000);
  const totals = { companies: companyRows.length, sent: 0, changed: 0, removed: 0, waiting: 0, failed: 0, busy: 0, stopped: 0 };
  const run = await runForEachCompany("api.cron.quickbooks-sync", companyRows, (c) => c.company_id, async (company) => {
    // A company's share of the run: never more than 90 seconds in all, split
    // between the jobs it has on, so one company with a long backlog can't
    // crowd out the rest.
    const jobs = [company.send_invoices, company.send_bills, company.send_costs].filter(Boolean).length;
    const budget = () => Math.max(10_000, Math.min(Math.floor(90_000 / Math.max(1, jobs)), 230_000 - (Date.now() - started)));
    const room = () => 230_000 - (Date.now() - started) >= 10_000;
    const add = (s: { sent: number; changed: number; removed: number; waiting: number; failed: number; busy?: boolean; error?: string }) => {
      totals.sent += s.sent;
      totals.changed += s.changed;
      totals.removed += s.removed;
      totals.waiting += s.waiting;
      totals.failed += s.failed;
      if (s.busy) totals.busy += 1;
      if (s.error) totals.stopped += 1;
    };
    let ran = false;
    // Invoices first: they add the jobs bills and lender fees are tagged with. The rest only with room left (else next run).
    if (company.send_invoices) {
      add(await syncCompanyInvoices(admin, company.company_id, { budgetMs: budget(), fetchImpl }));
      ran = true;
    }
    if (company.send_bills && (!ran || room())) {
      add(await syncCompanyBills(admin, company.company_id, { budgetMs: budget(), fetchImpl }));
      ran = true;
    }
    if (company.send_costs && (!ran || room())) add(await syncCompanyCosts(admin, company.company_id, { budgetMs: budget(), fetchImpl }));
  });
  return NextResponse.json({ ...totals, ...runSummary(run) });
}

// Room for every company's turn (runForEachCompany stops starting new
// ones at CRON_BUDGET_MS, before this limit).
export const maxDuration = 300;

export const POST = withRouteObservability("api.cron.quickbooks-sync", handlePost);
