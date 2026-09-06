import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { canViewProfitLoss } from "@/lib/data/accounting-access";
import { selectAll } from "@/lib/data/select-all";
import type {
  PLBill,
  PLBillPayment,
  PLContract,
  PLExpense,
  PLPayment,
  PLPhase,
} from "@/lib/data/profit-loss";
import { ProfitLossView, type PLJobInfo } from "./profit-loss-view";

export const dynamic = "force-dynamic";

type ContractRow = PLContract & { kind: string };
type LeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  address: string | null;
};

/**
 * Profit & Loss: the company's money as one statement -- income, job
 * costs, gross profit, overhead, net profit -- on a cash or accrual
 * reading. The arithmetic lives in lib/data/profit-loss with its tests;
 * this file only gates, fetches and hands over.
 *
 * The reads go through the admin client, gated FIRST. The tables behind
 * this report (vendor_bills, job_expenses) are RLS'd to the cost-money
 * roles, so a Sales user granted View Profit & Loss on Users & Roles
 * would otherwise get a report with silently empty cost sections -- the
 * same trap requestPhaseNow hit for Bookkeeping. Every query still pins
 * company_id explicitly.
 */
export default async function ProfitLossPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  if (!canViewProfitLoss(profile)) {
    return (
      <div className="empty-state">
        <p className="empty-label">You don&apos;t have access to Profit &amp; Loss</p>
        <p className="empty-hint">
          The P&amp;L is what the company earns — Office and Admin, or anyone switched on
          under Settings › Users &amp; Roles › View Profit &amp; Loss (View Financials
          comes with it).
        </p>
      </div>
    );
  }

  const admin = createAdminClient();
  const companyId = profile.company_id;

  const [contracts, phases, payments, expenses, bills, billPayments, vendors] =
    await Promise.all([
      selectAll<ContractRow>((f, t) =>
        admin
          .from("estimates")
          .select("id, lead_id, deposit_cents, signed_at, kind")
          .eq("company_id", companyId)
          .eq("status", "Signed")
          .range(f, t)
      ),
      selectAll<PLPhase>((f, t) =>
        admin
          .from("estimate_payments")
          .select("estimate_id, amount_cents, requested_at")
          .eq("company_id", companyId)
          .not("requested_at", "is", null)
          .range(f, t)
      ),
      selectAll<PLPayment>((f, t) =>
        admin
          .from("portal_payments")
          .select("estimate_id, lead_id, amount_cents, status, paid_at, created_at")
          .eq("company_id", companyId)
          .range(f, t)
      ),
      selectAll<PLExpense>((f, t) =>
        admin
          .from("job_expenses")
          .select("lead_id, amount_cents, spent_on, source")
          .eq("company_id", companyId)
          .range(f, t)
      ),
      selectAll<PLBill>((f, t) =>
        admin
          .from("vendor_bills")
          .select("id, lead_id, vendor_id, vendor_name, amount_cents, bill_date, created_at, voided_at")
          .eq("company_id", companyId)
          .range(f, t)
      ),
      selectAll<PLBillPayment>((f, t) =>
        admin
          .from("vendor_bill_payments")
          .select("bill_id, amount_cents, paid_on")
          .eq("company_id", companyId)
          .range(f, t)
      ),
      selectAll<{ id: string; name: string | null }>((f, t) =>
        admin.from("vendors").select("id, name").eq("company_id", companyId).range(f, t)
      ),
    ]);

  // A completion certificate is signed paperwork, not money: no deposit,
  // no phases. Filtered here so the engine never has to know kinds exist.
  const moneyDocs: PLContract[] = contracts
    .filter((c) => c.kind !== "completion")
    .map(({ id, lead_id, deposit_cents, signed_at }) => ({
      id,
      lead_id,
      deposit_cents,
      signed_at,
    }));

  // Names for the job rows -- only the leads the report can actually
  // mention. company_id is pinned again even though the ids came from
  // pinned queries: one habit, zero cross-tenant surprises.
  const leadIds = [
    ...new Set(
      [
        ...moneyDocs.map((c) => c.lead_id),
        ...expenses.map((e) => e.lead_id),
        ...payments.map((p) => p.lead_id),
        ...bills.map((b) => b.lead_id),
      ].filter(Boolean) as string[]
    ),
  ];
  const leads = leadIds.length
    ? await selectAll<LeadRow>((f, t) =>
        admin
          .from("leads")
          .select("id, first_name, last_name, company_name, address")
          .eq("company_id", companyId)
          .in("id", leadIds)
          .range(f, t)
      )
    : [];

  const jobs: PLJobInfo[] = leads.map((l) => ({
    leadId: l.id,
    name:
      [l.first_name, l.last_name].filter(Boolean).join(" ").trim() ||
      l.company_name ||
      "Unnamed job",
    address: l.address,
  }));

  return (
    <ProfitLossView
      contracts={moneyDocs}
      phases={phases}
      payments={payments}
      expenses={expenses}
      bills={bills}
      billPayments={billPayments}
      jobs={jobs}
      vendorNames={vendors.map((v) => ({ id: v.id, name: v.name }))}
    />
  );
}
