import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getRoleNamesCached } from "@/lib/data/company-chrome";
import { roleName } from "@/lib/role-names";
import { canViewFinancials } from "@/lib/data/accounting-access";
import { canEditJobCosts } from "@/lib/data/expense-edit";
import { type JobExpense, type Lead } from "@/lib/data/types";
import {
  paidOnEntryReceipts,
  type VendorBillRow as VendorBill,
  type VendorBillPaymentRow,
} from "@/lib/data/bills";
import { getVendors } from "@/lib/actions/vendors";
import { getPaymentAccounts } from "@/lib/actions/payment-accounts";
import type { BillsQuickBooks, ChipRecord } from "@/lib/quickbooks/bill-status";
import { quickBooksReceiptsReady } from "@/lib/quickbooks/receipts-ready";
import { quickbooksCredentials } from "@/lib/quickbooks/oauth";
import { onOtherSide } from "@/lib/quickbooks/connection-side";
import { BillsView } from "./bills-view";

export const dynamic = "force-dynamic";

/**
 * Bills to Pay: unpaid vendor bills, cash-impact view. Who do we owe,
 * what goes out this week, what is past its planned date. The page is
 * Bookkeeping's second home alongside Payments; RLS keeps the data to
 * the cost-money roles.
 */
export default async function BillsPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  // Was canManageBills (role only). canViewFinancials is that same role
  // check plus the View Financials switch, so this only ever widens who
  // gets in -- Bookkeeping, Office and Admin are unaffected.
  if (!canViewFinancials(profile)) {
    // The role as this company names it (DECISIONS #138).
    const bookkeeping = roleName(await getRoleNamesCached(profile.company_id), "Bookkeeping");
    return (
      <div className="empty-state">
        <p className="empty-label">You don&apos;t have access to bills</p>
        <p className="empty-hint">
          Bills to Pay is the company checkbook — {bookkeeping}, Office and Admin, or
          anyone switched on under Settings › Users &amp; Roles › View Financials.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const companyId = profile.company_id;

  const [bills, payments, vendorsRes, leads, expenses, accountsRes, qb] = await Promise.all([
    selectAll<VendorBill>((f, t) =>
      supabase
        .from("vendor_bills")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .range(f, t)
    ),
    // select * so the method column (migration 0124) rides along when it
    // exists and is simply absent when it doesn't.
    selectAll<VendorBillPaymentRow>((f, t) =>
      supabase
        .from("vendor_bill_payments")
        .select("*")
        .eq("company_id", companyId)
        .range(f, t)
    ),
    getVendors(true),
    // Only the customers with sold work -- bills link to jobs, and a
    // job is a signed contract. The picker and the group headers both
    // read from this.
    selectAll<Lead & { estimates?: unknown }>((f, t) =>
      supabase
        .from("leads")
        .select("id, first_name, last_name, company_name, address, estimates!inner(id)")
        .eq("company_id", companyId)
        .eq("estimates.status", "Signed")
        .range(f, t)
    ).then((rows) =>
      rows.map((r) => {
        const lead = { ...r };
        delete lead.estimates;
        return lead as Lead;
      })
    ),
    // Job costs saved as "Already paid" never become a bill, so the Paid
    // tab lists them from here -- otherwise a receipt filed from
    // Projects is on the job but nowhere on this page.
    selectAll<JobExpense>((f, t) =>
      supabase
        .from("job_expenses")
        .select(
          "id, company_id, lead_id, estimate_payment_id, vendor, vendor_id, category, description, " +
            "amount_cents, spent_on, source, qb_txn_id, qb_txn_type, qb_project_id, created_at, " +
            "receipt_url, receipt_path"
        )
        .eq("company_id", companyId)
        .range(f, t)
    ),
    getPaymentAccounts(true),
    quickBooksStatus(supabase, companyId),
  ]);

  // The inner join can return one row per signed document.
  const uniqueLeads = [...new Map(leads.map((l) => [l.id, l])).values()];
  const receipts = paidOnEntryReceipts(expenses, payments);

  // A receipt's job is almost always a signed one, but a job whose
  // contract was later voided would otherwise head its group as
  // "Unknown job". Only the ids actually referenced are fetched.
  const known = new Set(uniqueLeads.map((l) => l.id));
  const missing = [...new Set(receipts.map((r) => r.lead_id))].filter((id) => !known.has(id));
  const receiptLeads = missing.length
    ? ((
        await supabase
          .from("leads")
          .select("id, first_name, last_name, company_name, address")
          .eq("company_id", companyId)
          .in("id", missing)
      ).data ?? []) as Lead[]
    : [];

  return (
    <BillsView
      bills={bills}
      payments={payments}
      vendors={vendorsRes.vendors ?? []}
      jobLeads={uniqueLeads}
      receipts={receipts}
      receiptLeads={receiptLeads}
      canEditCosts={canEditJobCosts(profile)}
      accounts={accountsRes.accounts}
      qb={qb}
    />
  );
}

/**
 * Where each bill stands with QuickBooks (DECISIONS #173), and each
 * "Paid on entry" job cost once job costs go there (#199). The connection
 * is server-only (it holds the login), so it's read here, after the page's
 * own gate; the records are read as the viewer, through row-level security.
 */
async function quickBooksStatus(supabase: Awaited<ReturnType<typeof createClient>>, companyId: string): Promise<BillsQuickBooks | null> {
  const { data: conn, error } = await createAdminClient()
    .from("quickbooks_connections")
    .select("realm_id, environment, disconnected_at, send_bills, send_bills_from")
    .eq("company_id", companyId)
    .maybeSingle<{
      realm_id: string | null;
      environment: "sandbox" | "production";
      disconnected_at: string | null;
      send_bills: boolean;
      send_bills_from: string | null;
    }>();
  // Never connected, or before 0222: nothing to show.
  if (error || !conn?.realm_id) return null;
  // Connected on the other side of Intuit (a practice company after the
  // switch to real books): nothing goes, and what went isn't in these books
  // (DECISIONS #192). Settings says to connect again.
  if (onOtherSide(conn.environment, quickbooksCredentials()?.environment)) return null;
  const [records, receipts, costConn, fees] = await Promise.all([
    selectAll<ChipRecord>((f, t) =>
      supabase
        .from("quickbooks_sync")
        .select("record_type, record_id, bill_id, qb_id, status, failed_op, reason, sent_at")
        .eq("company_id", companyId)
        .eq("realm_id", conn.realm_id!)
        // A bill and its receipt share an id: ordered by both, so pages never overlap.
        .order("record_type")
        .order("record_id")
        .range(f, t)
    ),
    quickBooksReceiptsReady(createAdminClient()),
    // Job costs (step 4, DECISIONS #199) have their own switch, read apart: a database without 0230 still shows bills' lines.
    createAdminClient()
      .from("quickbooks_connections")
      .select("send_costs, send_costs_from")
      .eq("company_id", companyId)
      .maybeSingle<{ send_costs: boolean; send_costs_from: string | null }>(),
    lenderFeeIds(companyId),
  ]);
  const sending = conn.send_bills && !conn.disconnected_at;
  const costs = costConn.error
    ? null
    : { sending: !!costConn.data?.send_costs && !conn.disconnected_at, sendFrom: costConn.data?.send_costs_from ?? null, fees };
  if (!sending && !costs?.sending && !records.length) return null;
  return {
    sending,
    sendFrom: conn.send_bills_from,
    environment: conn.environment,
    realmId: conn.realm_id,
    records,
    receipts: receipts === true,
    costs,
  };
}

/** Which of the company's job costs are lender fees (0230's mark), so a cost not looked at yet shows what will happen to it.
 *  Read apart from the page's own cost list (which must not name a 0230 column); null when it can't be read. */
async function lenderFeeIds(companyId: string): Promise<string[] | null> {
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await createAdminClient()
      .from("job_expenses")
      .select("id")
      .eq("company_id", companyId)
      .eq("lender_fee", true)
      .order("id")
      .range(from, from + 999);
    if (error) return null;
    ids.push(...((data ?? []) as { id: string }[]).map((r) => r.id));
    if ((data ?? []).length < 1000) return ids;
  }
}
