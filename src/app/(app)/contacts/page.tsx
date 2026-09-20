import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import {
  canDeleteLeads,
  canManageBills,
  isStrictAdmin,
  canEditDispatch,
  type CalendarRow,
  type LeadSourceRow,
  type PipelineStageRow,
  type ProjectTypeRow,
} from "@/lib/data/types";
import { getLeadEstimateIndex } from "@/lib/data/lead-estimate-index";
import { dispatcherPickerBootstrap } from "@/lib/data/dispatcher-bootstrap";
import { getContactStats, listContacts } from "@/lib/actions/contact-list";
import { CONTACT_ROW_BATCH } from "./row-batch";
import { ContactsTable } from "./contacts-table";

export default async function ContactsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);
  const canDelete = canDeleteLeads(profile);
  const isAdmin = isStrictAdmin(profile);
  const companyId = profile?.company_id ?? "";

  // The book never rides along: the page carries the first batch of
  // rows, a total, and three counted tiles. Search runs server-side,
  // scrolling fetches the next batch, opening a row fetches that
  // contact's card data, and the duplicate banner's grouping arrives
  // after first paint. This page used to ship every lead, task, note,
  // and file in the company -- see DECISIONS #019/#020.
  const [
    estimateIndex,
    initialContacts,
    stats,
    allReps,
    { data: stages },
    { data: calendars },
    { data: projectTypes },
    { data: sources },
  ] = await Promise.all([
    getLeadEstimateIndex(),
    listContacts({ search: "", offset: 0, limit: CONTACT_ROW_BATCH }),
    getContactStats(),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase.from("pipeline_stages").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase.from("calendars").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase.from("project_types").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase.from("lead_sources").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
  ]);
  const reps = allReps.filter((r) => r.status === "Active").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <ContactsTable
      initialRows={initialContacts.rows}
      initialTotal={initialContacts.total}
      stats={stats}
      reps={reps}
      allMembers={allReps}
      stages={(stages as PipelineStageRow[]) ?? []}
      calendars={(calendars as CalendarRow[]) ?? []}
      projectTypes={(projectTypes as ProjectTypeRow[]) ?? []}
      sources={(sources as LeadSourceRow[]) ?? []}
      canWrite={canWrite}
      canDelete={canDelete}
      isAdmin={isAdmin}
      canManageMoney={canManageBills(profile)}
      estimateIndex={estimateIndex}
      dispatcherPicker={dispatcherPickerBootstrap(profile, allReps)}
    />
  );
}
