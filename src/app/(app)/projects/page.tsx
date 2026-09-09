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
} from "@/lib/data/types";
import { buildProjectCards, type ProjectLead } from "./project-data";
import { ProjectsView } from "./projects-view";
import { CrewProjectsView, type CrewJob } from "./crew-view";

export const dynamic = "force-dynamic";

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

  // The cards themselves -- fetch and rollup -- live in project-data.ts,
  // shared with the printable reports so the paper and the screen can
  // never disagree about a figure.
  const { cards, holdReady, reps } = await buildProjectCards(supabase, companyId);

  // Checklists arrived in 0104. Queried separately and tolerantly, so
  // the money view never depends on the newest migration having run.
  // select * for the same reason vendor_bills uses it above: note
  // arrives with migration 0128, and naming it would empty the whole
  // checklist on every job until that has been run.
  const [{ data: checklistRows, error: clErr }, { data: templateRows }] = await Promise.all([
    supabase
      .from("project_checklist_items")
      .select("*")
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
      canCheckRain={isAdminRole(profile)}
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
  /** Free text on the step; the column arrives with migration 0128. */
  note?: string | null;
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

  const [estimates, leads, checklistRows, reps, rainEvents] = await Promise.all([
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
    // select * here too -- the crew reads the notes, and no column on
    // this table is a money column, so * cannot widen what they see.
    admin
      .from("project_checklist_items")
      .select("*")
      .eq("company_id", companyId)
      .order("sort_order", { ascending: true })
      .then((r) => (r.data as ChecklistRow[] | null) ?? []),
    selectAll<{ id: string; name: string | null }>((from, to) =>
      admin.from("profiles").select("id, name").in("id", memberIds).range(from, to)
    ),
    // Only appointments still ahead of today -- a rain check made for a
    // visit that already happened is not a warning anymore.
    selectAll<{ lead_id: string | null; rain_alert_pop: number | null }>((from, to) =>
      admin
        .from("events")
        .select("lead_id, rain_alert_pop")
        .eq("company_id", companyId)
        .in("status", ["New", "Confirmed"])
        .not("lead_id", "is", null)
        .not("rain_alert_pop", "is", null)
        .gte("date", new Date().toISOString().slice(0, 10))
        .range(from, to)
    ),
  ]);

  // Highest reading per lead -- a job with several upcoming visits shows
  // its worst one, the same way the office rollup surfaces the worst job.
  const rainPopByLead = new Map<string, number>();
  for (const e of rainEvents) {
    if (!e.lead_id || e.rain_alert_pop === null) continue;
    const current = rainPopByLead.get(e.lead_id) ?? 0;
    if (e.rain_alert_pop > current) rainPopByLead.set(e.lead_id, e.rain_alert_pop);
  }

  // The project's own site reading (rain-alerts cron, migration 0139).
  // A separate, deliberately fragile query: before the migration runs it
  // errors, comes back empty, and the crew page carries on with the
  // appointment-based readings alone -- unlike the main estimates select
  // above, which must never name a column newer than what's deployed.
  const rainPopByEstimate = new Map<string, number>();
  const { data: projectRain } = await admin
    .from("estimates")
    .select("id, rain_alert_pop")
    .eq("company_id", companyId)
    .not("rain_alert_pop", "is", null);
  for (const r of (projectRain ?? []) as { id: string; rain_alert_pop: number | null }[]) {
    if (r.rain_alert_pop !== null) rainPopByEstimate.set(r.id, r.rain_alert_pop);
  }

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
      // Worst of the two readings: the job site's own 48h check and any
      // upcoming appointment's.
      const evPop = rainPopByLead.get(contract.lead_id);
      const sitePop = rainPopByEstimate.get(contract.id);
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
        rainAlertPop:
          evPop === undefined && sitePop === undefined
            ? null
            : Math.max(evPop ?? 0, sitePop ?? 0),
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
