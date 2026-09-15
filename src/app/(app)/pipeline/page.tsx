import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import {
  canDeleteLeads,
  canManageBills,
  isStrictAdmin,
  canCreateLeads,
  canEditDispatch,
  type CalendarRow,
  type LeadSourceRow,
  type PipelineStageRow,
  type ProjectTypeRow,
} from "@/lib/data/types";
import { getLeadEstimateIndex } from "@/lib/data/lead-estimate-index";
import { dispatcherPickerBootstrap } from "@/lib/data/dispatcher-bootstrap";
import { getPipelineBoardData } from "@/lib/actions/pipeline-board";
import { PIPELINE_CARD_WINDOW } from "./board-query";
import { PipelineBoard } from "./pipeline-board";

export default async function PipelinePage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);
  const canDelete = canDeleteLeads(profile);
  const isAdmin = isStrictAdmin(profile);
  const companyId = profile?.company_id ?? "";

  // The book itself never rides along: each column carries its first
  // window of cards plus an exact count, the stat tiles arrive as
  // numbers, and a lead's tasks/notes/files are fetched when its card
  // is opened. This page used to ship every lead, task, note, and file
  // in the company -- see DECISIONS #020.
  const [
    estimateIndex,
    initialBoard,
    allReps,
    { data: stages },
    { data: calendars },
    { data: projectTypes },
    { data: sources },
  ] = await Promise.all([
    getLeadEstimateIndex(),
    getPipelineBoardData({
      statusFilter: "Open",
      repFilter: "All",
      receivedSince: "",
      receivedBefore: "",
      noApptOnly: false,
      sortBy: "Days",
      sortDir: "asc",
      window: PIPELINE_CARD_WINDOW,
    }),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase.from("pipeline_stages").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase.from("calendars").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase.from("project_types").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase.from("lead_sources").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
  ]);
  const reps = allReps.filter((r) => r.status === "Active").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <PipelineBoard
      initialBoard={initialBoard}
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
