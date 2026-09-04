import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import {
  canEditChecklists,
  canManageBills,
  canManageCosts,
  canUploadLeadFiles,
  canViewEstimates,
  isAdminRole,
  isFieldRole,
  computeProjectRollup,
  billRemainingCents,
  type Estimate,
  type EstimatePayment,
  type JobExpense,
  type PortalPayment,
} from "@/lib/data/types";
import { ProjectsView, type ProjectCard } from "./projects-view";
import { CrewProjectsView, type CrewJob } from "./crew-view";

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
    // The crew's version of this page: jobs, receipts, photos and
    // checklists, with no dollar figure anywhere. Field users cannot
    // read estimate rows at all under RLS, so this view is fed by its
    // own query below -- one that never selects a money column, which
    // is the point: the numbers aren't hidden from the crew's page,
    // they are never in it.
    if (isFieldRole(profile)) return <CrewProjects companyId={profile.company_id} />;
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
  const [estimates, payments, paid, expenses, leads, reps, openBills, billPayments] = await Promise.all([
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
    // THIS company's members, not "every profile the viewer can see".
    // RLS confines a bare profiles select to co-members, but across ALL
    // of the viewer's companies -- for a multi-company owner the
    // assignee dropdown was listing other tenants' people (a stray
    // "Vanessa" from a different company sat above Vanessa Sandoval).
    supabase
      .from("company_members")
      .select("profile_id")
      .eq("company_id", companyId)
      .then(async ({ data: mem }) => {
        const ids = [...new Set((mem ?? []).map((m) => m.profile_id as string))];
        if (!ids.length) return [] as { id: string; name: string | null }[];
        const { data } = await supabase.from("profiles").select("id, name").in("id", ids);
        return (data ?? []) as { id: string; name: string | null }[];
      }),
    // Unpaid vendor bills, job by job. RLS hands a role without cost
    // access an empty list, and the column simply reads blank.
    // select * because estimate_payment_id arrives with migration 0123
    // and naming it would break the page before that has run.
    selectAll<{ id: string; lead_id: string | null; amount_cents: number; estimate_payment_id?: string | null }>((from, to) =>
      supabase
        .from("vendor_bills")
        .select("*")
        .eq("company_id", companyId)
        .is("voided_at", null)
        .not("lead_id", "is", null)
        .range(from, to)
    ),
    selectAll<{ bill_id: string; amount_cents: number }>((from, to) =>
      supabase
        .from("vendor_bill_payments")
        .select("bill_id, amount_cents")
        .eq("company_id", companyId)
        .range(from, to)
    ),
  ]);

  // What each job still owes its vendors: every live bill minus what
  // has been paid on it. Kept apart from Spent -- the money hasn't left.
  const paymentsByBill = new Map<string, { amount_cents: number }[]>();
  for (const p of billPayments) {
    const list = paymentsByBill.get(p.bill_id) ?? [];
    list.push(p);
    paymentsByBill.set(p.bill_id, list);
  }
  const unpaidBills = openBills
    .map((b) => ({ ...b, remaining: billRemainingCents(b, paymentsByBill.get(b.id) ?? []) }))
    .filter((b) => b.lead_id && b.remaining > 0);

  // Signed contracts are live projects; a voided one that had been
  // signed is a cancelled project -- still worth listing, because a job
  // that fell through is a fact about the book, not a secret.
  const contracts = estimates.filter(
    (e) =>
      (e.kind ?? "contract") === "contract" &&
      (e.status === "Signed" || (e.status === "Void" && e.signed_at))
  );

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

    // Cancelled and Complete are derived from documents that already
    // exist, so they can never contradict them. Only On Hold is stored.
    const completionSigned = changeOrders.some(
      (e) => (e.kind ?? "") === "completion" && e.status === "Signed"
    );
    const status =
      contract.status === "Void"
        ? ("cancelled" as const)
        : (contract as { project_on_hold?: boolean }).project_on_hold
          ? ("on_hold" as const)
          : completionSigned || contract.completed_on
            ? ("complete" as const)
            : ("in_progress" as const);

    const lead = leadById.get(contract.lead_id) ?? null;
    return {
      status,
      estimateId: contract.id,
      docNumber: contract.doc_number,
      title: contract.title,
      leadId: contract.lead_id,
      customer:
        lead?.company_name ||
        [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") ||
        "Unnamed customer",
      // Every non-void child document, for the client-view shortcuts --
      // the customer can be shown a draft change order too, that is
      // what the preview is for.
      changeOrders: changeOrders
        .filter((e) => e.status !== "Void")
        .map((e) => ({ id: e.id, docNumber: e.doc_number, title: e.title })),
      // The job site outranks the billing address: an investor with
      // three properties needs three rows that say which house is which.
      address: (contract as { job_address?: string | null }).job_address ?? lead?.address ?? null,
      repName: lead?.assigned_to ? (repById.get(lead.assigned_to) ?? null) : null,
      signedAt: contract.signed_at ?? null,
      changeOrderCount: signedChangeOrders.length,
      rollup,
      // Same rule as costs: a bill filed to one of this contract's
      // phases is this row's; an unfiled bill is the customer's, and
      // lands here only when this is their one contract.
      unpaidBillsCents: unpaidBills
        .filter(
          (b) =>
            b.lead_id === contract.lead_id &&
            (b.estimate_payment_id
              ? ownPhaseIds.has(b.estimate_payment_id)
              : (contractsPerLead.get(contract.lead_id) ?? 1) === 1)
        )
        .reduce((s, b) => s + b.remaining, 0),
    };
  });

  // The hold toggle writes a column added by migration 0093. Until that
  // migration has run, the column is absent from these rows and the
  // button could only fail -- so it does not appear.
  const holdReady = estimates.length === 0 || "project_on_hold" in estimates[0];

  // Checklists arrived in 0104. Queried separately and tolerantly, so
  // the money view never depends on the newest migration having run.
  const [{ data: checklistRows, error: clErr }, { data: templateRows }] = await Promise.all([
    supabase
      .from("project_checklist_items")
      .select("id, estimate_id, label, sort_order, due_date, assigned_to, completed_at, completed_by")
      .eq("company_id", companyId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("checklist_templates")
      .select("id, name, items, updated_at")
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
  ]);

  return (
    <ProjectsView
      projects={cards}
      canManage={isAdminRole(profile) && holdReady}
      canAddCosts={canManageCosts(profile)}
      canBills={canManageBills(profile)}
      canUploadPhotos={canUploadLeadFiles(profile)}
      canSeeDocChips={isAdminRole(profile) || profile.roles.includes("Production")}
      canFileDocs={canEditChecklists(profile)}
      checklistReady={!clErr}
      checklistItems={(checklistRows as ChecklistRow[]) ?? []}
      templates={
        ((templateRows as { id: string; name: string; items: unknown[] }[]) ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          count: t.items?.length ?? 0,
        }))
      }
      canEditChecklist={canEditChecklists(profile)}
      canRemoveChecklist={isAdminRole(profile)}
      memberNames={Object.fromEntries(reps.map((r) => [r.id, r.name ?? ""]))}
    />
  );
}

type ChecklistRow = {
  id: string;
  estimate_id: string;
  label: string;
  sort_order: number;
  due_date: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  completed_by: string | null;
};

/**
 * The field crew's Projects data. Fetched with the admin client because
 * RLS (correctly) refuses a Field user every estimates row -- and scoped
 * by hand to their company, selecting ONLY columns with no money in
 * them. total_cents, payments and expenses are never queried, so the
 * crew page's payload cannot leak a number it was built to omit.
 */
async function CrewProjects({ companyId }: { companyId: string }) {
  const admin = createAdminClient();

  // The admin client answers exactly what it is asked, so every query
  // below is scoped by hand. profiles has no company column -- scope it
  // through this company's membership rows, or the names map would
  // quietly hold every user on the platform.
  const memberIds =
    (await admin.from("company_members").select("profile_id").eq("company_id", companyId)).data?.map(
      (r) => r.profile_id as string
    ) ?? [];

  type SlimEstimate = {
    id: string;
    doc_number: string;
    title: string | null;
    lead_id: string;
    status: string;
    kind: string | null;
    parent_estimate_id: string | null;
    signed_at: string | null;
    completed_on: string | null;
    project_on_hold: boolean | null;
  };

  const [estimates, leads, checklistRows, reps] = await Promise.all([
    selectAll<SlimEstimate>((from, to) =>
      admin
        .from("estimates")
        .select(
          "id, doc_number, title, lead_id, status, kind, parent_estimate_id, signed_at, completed_on, project_on_hold"
        )
        .eq("company_id", companyId)
        .range(from, to)
    ),
    selectAll<ProjectLead>((from, to) =>
      admin
        .from("leads")
        .select("id, first_name, last_name, company_name, address, assigned_to")
        .eq("company_id", companyId)
        .range(from, to)
    ),
    admin
      .from("project_checklist_items")
      .select("id, estimate_id, label, sort_order, due_date, assigned_to, completed_at, completed_by")
      .eq("company_id", companyId)
      .order("sort_order", { ascending: true })
      .then((r) => (r.data as ChecklistRow[] | null) ?? []),
    selectAll<{ id: string; name: string | null }>((from, to) =>
      admin.from("profiles").select("id, name").in("id", memberIds).range(from, to)
    ),
  ]);

  const leadById = new Map(leads.map((l) => [l.id, l]));

  // Same project derivation the full page uses, minus everything the
  // crew doesn't get: voided contracts (a cancelled job is office
  // business) and every rollup.
  const contracts = estimates.filter(
    (e) => (e.kind ?? "contract") === "contract" && e.status === "Signed"
  );

  const jobs: CrewJob[] = contracts
    .map((contract) => {
      const completionSigned = estimates.some(
        (e) =>
          e.parent_estimate_id === contract.id &&
          (e.kind ?? "") === "completion" &&
          e.status === "Signed"
      );
      const lead = leadById.get(contract.lead_id) ?? null;
      return {
        estimateId: contract.id,
        docNumber: contract.doc_number,
        title: contract.title ?? "",
        leadId: contract.lead_id,
        customer:
          lead?.company_name ||
          [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") ||
          "Unnamed customer",
        address: lead?.address ?? null,
        status: contract.project_on_hold
          ? ("on_hold" as const)
          : completionSigned || contract.completed_on
            ? ("complete" as const)
            : ("in_progress" as const),
      };
    })
    .sort((a, b) => a.customer.localeCompare(b.customer));

  const jobEstimateIds = new Set(jobs.map((j) => j.estimateId));

  return (
    <CrewProjectsView
      jobs={jobs}
      checklistItems={checklistRows.filter((c) => jobEstimateIds.has(c.estimate_id))}
      memberNames={Object.fromEntries(reps.map((r) => [r.id, r.name ?? ""]))}
    />
  );
}
