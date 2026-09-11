import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import {
  canDeleteLeads,
  canManageBills,
  isStrictAdmin,
  canCreateLeads,
  canEditDispatch,
  type CalendarRow,
  type Lead,
  type LeadFile,
  type LeadNote,
  type LeadSourceRow,
  type LeadTask,
  type PipelineStageRow,
  type ProjectTypeRow,
} from "@/lib/data/types";
import { getLeadEstimateIndex } from "@/lib/data/lead-estimate-index";
import { dispatcherPickerBootstrap } from "@/lib/data/dispatcher-bootstrap";
import { PipelineBoard } from "./pipeline-board";

export default async function PipelinePage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);
  const canDelete = canDeleteLeads(profile);
  const isAdmin = isStrictAdmin(profile);
  const companyId = profile?.company_id ?? "";

  const [
    estimateIndex,
    leads,
    tasks,
    notes,
    { data: files },
    allReps,
    { data: stages },
    { data: calendars },
    { data: projectTypes },
    { data: sources },
  ] = await Promise.all([
    // Loaded with the page so the contact card's estimate chip is there
    // on the first frame rather than a couple of seconds in. It needs
    // nothing from the queries beside it, so it belongs inside this
    // parallel block rather than in a round trip ahead of it.
    getLeadEstimateIndex(),
    selectAll<Lead>((f, t) =>
      supabase
        .from("leads")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .range(f, t)
    ),
    selectAll<LeadTask>((f, t) =>
      supabase
        .from("lead_tasks")
        .select("id, lead_id, title, due_date, completed_at, assigned_to, created_at")
        .eq("company_id", companyId)
        .range(f, t)
    ),
    selectAll<LeadNote>((f, t) =>
      supabase
        .from("lead_notes")
        .select("id, lead_id, author_id, body, event_id, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .range(f, t)
    ),
    supabase
      .from("lead_files")
      .select(
        "id, lead_id, uploaded_by, file_name, file_path, file_url, file_size, content_type, storage_provider, created_at"
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase.from("pipeline_stages").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase.from("calendars").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase.from("project_types").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase.from("lead_sources").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
  ]);
  const reps = allReps.filter((r) => r.status === "Active").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <PipelineBoard
      leads={leads}
      tasks={tasks}
      notes={notes}
      files={(files as LeadFile[]) ?? []}
      reps={reps}
      // Everyone, including deactivated members. `reps` is filtered to
      // Active because it feeds the assignment dropdowns, but a lead can
      // still be held by someone who has since left -- and looking that
      // name up in the Active list only would print "Unassigned" over a
      // lead that is very much assigned.
      allMembers={allReps}
      stages={(stages as PipelineStageRow[]) ?? []}
      calendars={(calendars as CalendarRow[]) ?? []}
      projectTypes={(projectTypes as ProjectTypeRow[]) ?? []}
      sources={(sources as LeadSourceRow[]) ?? []}
      canWrite={canWrite}
      canCreateLeads={canCreateLeads(profile)}
      canDelete={canDelete}
      isAdmin={isAdmin}
      canManageMoney={canManageBills(profile)}
      estimateIndex={estimateIndex}
      dispatcherPicker={dispatcherPickerBootstrap(profile, allReps)}
    />
  );
}
