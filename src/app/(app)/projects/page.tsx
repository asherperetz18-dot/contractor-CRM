import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import {
  canViewEstimates,
  computeProjectRollup,
  type Estimate,
  type EstimatePayment,
  type JobExpense,
  type PortalPayment,
} from "@/lib/data/types";
import { ProjectsView, type ProjectCard } from "./projects-view";

export const dynamic = "force-dynamic";

type ProjectLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  address: string | null;
  assigned_to: string | null;
};

/**
 * Sold jobs, with the money on top.
 *
 * A project here is a signed contract plus its change orders -- not a
 * new record. Everything it shows already exists on the contract and the
 * lead; what was missing was anywhere that put them side by side and
 * said whether the job is making money.
 */
export default async function ProjectsPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  if (!canViewEstimates(profile)) {
    return (
      <div className="empty-state">
        <p className="empty-label">You don&apos;t have access to projects</p>
        <p className="empty-hint">
          A project is a signed contract and its money. Ask an Office or Admin user to switch
          on View Estimates for you in Admin Settings &rarr; Users &amp; Roles.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const companyId = profile.company_id;

  // selectAll throughout: a bare select stops at 1000 rows in silence,
  // and a projects page that quietly omits jobs is worse than none.
  const [estimates, payments, paid, expenses, leads, reps] = await Promise.all([
    selectAll<Estimate>((from, to) =>
      supabase.from("estimates").select("*").eq("company_id", companyId).range(from, to)
    ),
    selectAll<EstimatePayment>((from, to) =>
      supabase
        .from("estimate_payments")
        .select("id, estimate_id, sort_order, name, description, amount_cents, requested_at, due_date")
        .eq("company_id", companyId)
        .range(from, to)
    ),
    selectAll<PortalPayment>((from, to) =>
      supabase
        .from("portal_payments")
        .select("id, estimate_id, estimate_payment_id, kind, amount_cents, status, method, paid_at, created_at")
        .eq("company_id", companyId)
        .range(from, to)
    ),
    selectAll<JobExpense>((from, to) =>
      supabase
        .from("job_expenses")
        .select("id, company_id, lead_id, estimate_payment_id, vendor, category, description, amount_cents, spent_on, source, qb_txn_id, qb_txn_type, qb_project_id, created_at")
        .eq("company_id", companyId)
        .range(from, to)
    ),
    selectAll<ProjectLead>((from, to) =>
      supabase
        .from("leads")
        .select("id, first_name, last_name, company_name, address, assigned_to")
        .eq("company_id", companyId)
        .range(from, to)
    ),
    selectAll<{ id: string; name: string | null }>((from, to) =>
      supabase.from("profiles").select("id, name").range(from, to)
    ),
  ]);

  const contracts = estimates.filter((e) => e.status === "Signed" && (e.kind ?? "contract") === "contract");

  // How many signed contracts each customer has. A cost that no phase
  // claims belongs to the customer, not to a document -- so when they
  // have two live contracts there is no honest way to say which one it
  // hit, and it must not be quietly added to either.
  const contractsPerLead = new Map<string, number>();
  for (const c of contracts) {
    contractsPerLead.set(c.lead_id, (contractsPerLead.get(c.lead_id) ?? 0) + 1);
  }

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const repById = new Map(reps.map((r) => [r.id, r.name]));
  const phaseById = new Map(payments.map((p) => [p.id, p]));

  const cards: ProjectCard[] = contracts.map((contract) => {
    const changeOrders = estimates.filter((e) => e.parent_estimate_id === contract.id);
    const signedChangeOrders = changeOrders.filter((e) => e.status === "Signed");
    // Every document the project's money can arrive against.
    const docIds = new Set([contract.id, ...changeOrders.map((e) => e.id)]);

    const ownPhases = payments.filter((p) => docIds.has(p.estimate_id));
    const ownPhaseIds = new Set(ownPhases.map((p) => p.id));

    const leadExpenses = expenses.filter((e) => e.lead_id === contract.lead_id);
    const filedCostCents = leadExpenses
      .filter((e) => e.estimate_payment_id && ownPhaseIds.has(e.estimate_payment_id))
      .reduce((s, e) => s + e.amount_cents, 0);
    const unfiledCostCents = leadExpenses
      .filter((e) => !e.estimate_payment_id || !phaseById.has(e.estimate_payment_id))
      .reduce((s, e) => s + e.amount_cents, 0);

    const rollup = computeProjectRollup({
      contractTotalCents: contract.total_cents,
      signedChangeOrderCents: signedChangeOrders.reduce((s, e) => s + e.total_cents, 0),
      payments: paid.filter((p) => docIds.has(p.estimate_id)),
      // Billed means the phase was actually requested from the customer.
      billedCents: ownPhases
        .filter((p) => p.requested_at)
        .reduce((s, p) => s + p.amount_cents, 0),
      filedCostCents,
      unfiledCostCents,
      ownsUnfiledCosts: (contractsPerLead.get(contract.lead_id) ?? 1) === 1,
    });

    const lead = leadById.get(contract.lead_id) ?? null;
    return {
      estimateId: contract.id,
      docNumber: contract.doc_number,
      title: contract.title,
      leadId: contract.lead_id,
      customer:
        lead?.company_name ||
        [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") ||
        "Unnamed customer",
      address: lead?.address ?? null,
      repName: lead?.assigned_to ? (repById.get(lead.assigned_to) ?? null) : null,
      signedAt: contract.signed_at ?? null,
      changeOrderCount: signedChangeOrders.length,
      rollup,
    };
  });

  return <ProjectsView projects={cards} />;
}
