import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { canViewFinancials } from "@/lib/data/accounting-access";
import { type JobExpense, type Lead } from "@/lib/data/types";
import {
  paidOnEntryReceipts,
  type VendorBillRow as VendorBill,
  type VendorBillPaymentRow,
} from "@/lib/data/bills";
import { getVendors } from "@/lib/actions/vendors";
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
    return (
      <div className="empty-state">
        <p className="empty-label">You don&apos;t have access to bills</p>
        <p className="empty-hint">
          Bills to Pay is the company checkbook — Bookkeeping, Office and Admin, or
          anyone switched on under Settings › Users &amp; Roles › View Financials.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const companyId = profile.company_id;

  const [bills, payments, vendorsRes, leads, expenses] = await Promise.all([
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
    />
  );
}
