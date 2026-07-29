import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import {
  canDeleteLeads,
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
import { PipelineBoard } from "./pipeline-board";

export default async function PipelinePage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);
  const canDelete = canDeleteLeads(profile);

  const [
    { data: leads },
    { data: tasks },
    { data: notes },
    { data: files },
    allReps,
    { data: stages },
    { data: calendars },
    { data: projectTypes },
    { data: sources },
  ] = await Promise.all([
    supabase.from("leads").select("*").order("created_at", { ascending: false }),
    supabase
      .from("lead_tasks")
      .select("id, lead_id, title, due_date, completed_at, assigned_to, created_at"),
    supabase
      .from("lead_notes")
      .select("id, lead_id, author_id, body, event_id, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("lead_files")
      .select(
        "id, lead_id, uploaded_by, file_name, file_path, file_url, file_size, content_type, storage_provider, created_at"
      )
      .order("created_at", { ascending: false }),
    profile ? getCompanyMembers(profile.company_id) : Promise.resolve([]),
    supabase.from("pipeline_stages").select("*").order("sort_order", { ascending: true }),
    supabase.from("calendars").select("*").order("sort_order", { ascending: true }),
    supabase.from("project_types").select("*").order("sort_order", { ascending: true }),
    supabase.from("lead_sources").select("*").order("sort_order", { ascending: true }),
  ]);
  const reps = allReps.filter((r) => r.status === "Active").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <PipelineBoard
      leads={(leads as Lead[]) ?? []}
      tasks={(tasks as LeadTask[]) ?? []}
      notes={(notes as LeadNote[]) ?? []}
      files={(files as LeadFile[]) ?? []}
      reps={reps}
      stages={(stages as PipelineStageRow[]) ?? []}
      calendars={(calendars as CalendarRow[]) ?? []}
      projectTypes={(projectTypes as ProjectTypeRow[]) ?? []}
      sources={(sources as LeadSourceRow[]) ?? []}
      canWrite={canWrite}
      canDelete={canDelete}
    />
  );
}
