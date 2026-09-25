"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import { isoDateInZone } from "@/lib/company-clock";
import { zoneForCompany } from "@/lib/data/company-today";
import { isAdminRole, type JobExpense, type Vendor } from "@/lib/data/types";
import { jobLedger, type JobLedgerInput, type LedgerEntry } from "@/lib/data/job-ledger";
import { getJobExpenses } from "@/lib/actions/job-expenses";
import { getOpenJobBills } from "@/lib/actions/vendor-bills";
import { getVendors } from "@/lib/actions/vendors";

export type JobLedgerResult = {
  entries: LedgerEntry[];
  totals: { collectedCents: number; owedCents: number; spentCents: number; billsUnpaidCents: number };
  /** Costs no contract claims, on a customer with several contracts. */
  unassigned: { id: string; label: string; amountCents: number }[];
  /** The job's costs, for ✎ Edit. */
  expenses: JobExpense[];
  vendors: Vendor[];
  contractDocNumber: string;
};

/**
 * Every dollar on one project, for the Transactions list under its row
 * on Projects. Read as the signed-in user, so RLS narrows it exactly as
 * the row's own figures are narrowed (a role without cost access gets
 * no costs or bills here, and none on the row either).
 *
 * Loaded when a row is opened, never polled.
 */
export async function getJobLedger(contractId: string): Promise<{ error?: string; ledger?: JobLedgerResult }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  // The row's document shortcuts are Office/Admin/Production; the list
  // itemizes the same money.
  if (!isAdminRole(profile) && !profile.roles.includes("Production")) {
    return { error: "You don't have access to this job's money." };
  }

  const supabase = await createClient();
  const { data: contract } = await supabase
    .from("estimates")
    .select("id, lead_id, doc_number")
    .eq("id", contractId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; lead_id: string; doc_number: string }>();
  if (!contract) return { error: "Project not found." };

  const { data: leadDocs } = await supabase
    .from("estimates")
    .select("id, kind, status, doc_number, title, total_cents, parent_estimate_id, signed_at")
    .eq("company_id", profile.company_id)
    .eq("lead_id", contract.lead_id)
    .returns<
      (JobLedgerInput["docs"][number] & { parent_estimate_id: string | null; signed_at: string | null })[]
    >();
  const docs = leadDocs ?? [];
  const docIds = docs.map((d) => d.id);

  const [phases, payments, expensesRes, billsRes, vendorsRes, zone] = await Promise.all([
    selectAll<JobLedgerInput["phases"][number]>((f, t) =>
      supabase
        .from("estimate_payments")
        .select("id, estimate_id, name, sort_order, amount_cents, requested_at, due_date")
        .eq("company_id", profile.company_id)
        .in("estimate_id", docIds)
        .range(f, t)
    ),
    selectAll<JobLedgerInput["payments"][number]>((f, t) =>
      supabase
        .from("portal_payments")
        .select("id, estimate_id, estimate_payment_id, kind, amount_cents, status, method, reference, paid_at, created_at")
        .eq("company_id", profile.company_id)
        .in("estimate_id", docIds)
        .range(f, t)
    ),
    getJobExpenses(contract.lead_id),
    getOpenJobBills(contract.lead_id),
    getVendors(true),
    zoneForCompany(supabase, profile.company_id),
  ]);
  const expenses = expensesRes.expenses ?? [];
  const vendors = vendorsRes.vendors ?? [];
  const vendorName = (id: string | null, text: string | null) => {
    const v = id ? vendors.find((x) => x.id === id) : null;
    return v ? v.name : text;
  };

  // Which costs an invoice already bills back (0180). Before that
  // migration the column is missing and nothing is linked yet.
  const billedOn: Record<string, string> = {};
  if (expenses.length) {
    const { data: links, error } = await supabase
      .from("estimate_items")
      .select("source_expense_id, estimates!inner ( doc_number, status, kind )")
      .eq("company_id", profile.company_id)
      .in("source_expense_id", expenses.map((e) => e.id))
      .returns<
        {
          source_expense_id: string;
          estimates: { doc_number: string; status: string; kind: string | null } | null;
        }[]
      >();
    if (!error) {
      for (const l of links ?? []) {
        if (l.estimates?.kind === "invoice" && l.estimates.status !== "Void") {
          billedOn[l.source_expense_id] = l.estimates.doc_number;
        }
      }
    }
  }

  const { entries, totals, unassigned } = jobLedger({
    contractId: contract.id,
    docs: docs.filter((d) => d.id === contract.id || d.parent_estimate_id === contract.id),
    phases,
    payments,
    costs: expenses.map((e) => ({
      id: e.id,
      description: e.description,
      category: e.category,
      vendorName: vendorName(e.vendor_id, e.vendor),
      amount_cents: e.amount_cents,
      spent_on: e.spent_on,
      estimate_payment_id: e.estimate_payment_id,
      receipt_url: e.receipt_url,
      receipt_path: e.receipt_path,
      source: e.source,
    })),
    // The same population the row uses to decide whether unfiled costs
    // are this job's: signed contracts, cancelled ones included.
    contractsOnLead: docs.filter(
      (d) => (d.kind ?? "contract") === "contract" && (d.status === "Signed" || (d.status === "Void" && d.signed_at))
    ).length,
    openBills: (billsRes.bills ?? []).map((b) => ({
      id: b.id,
      estimate_payment_id: b.estimate_payment_id,
      vendorName: vendorName(b.vendor_id, b.vendor_name),
      reference: b.reference,
      amount_cents: b.amount_cents,
      remaining_cents: b.remaining_cents,
      bill_date: b.bill_date,
      due_date: b.due_date,
      receipt_url: b.receipt_url,
      receipt_path: b.receipt_path,
    })),
    billedOn,
    toDay: (iso) => isoDateInZone(new Date(iso), zone),
  });

  return {
    ledger: {
      entries,
      totals,
      unassigned: unassigned.map((c) => ({
        id: c.id,
        label: c.description || c.category || c.vendorName || "Cost",
        amountCents: c.amount_cents,
      })),
      expenses,
      vendors,
      contractDocNumber: contract.doc_number,
    },
  };
}
