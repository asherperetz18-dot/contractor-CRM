import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canManageBills,
  type Lead,
  type Vendor,
  type VendorBill,
  type VendorBillPayment,
} from "@/lib/data/types";
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

  if (!canManageBills(profile)) {
    return (
      <div className="empty-state">
        <p className="empty-label">You don&apos;t have access to bills</p>
        <p className="empty-hint">
          Bills to Pay is the company checkbook — Bookkeeping, Office and Admin. Ask an
          admin to adjust your role if you need it.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const companyId = profile.company_id;

  const [bills, payments, vendorsRes, leads] = await Promise.all([
    selectAll<VendorBill>((f, t) =>
      supabase
        .from("vendor_bills")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .range(f, t)
    ),
    selectAll<VendorBillPayment>((f, t) =>
      supabase
        .from("vendor_bill_payments")
        .select("id, bill_id, amount_cents, paid_on, check_number, note, job_expense_id")
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
  ]);

  // The inner join can return one row per signed document.
  const uniqueLeads = [...new Map(leads.map((l) => [l.id, l])).values()];

  return (
    <BillsView
      bills={bills}
      payments={payments}
      vendors={vendorsRes.vendors ?? []}
      jobLeads={uniqueLeads}
    />
  );
}
