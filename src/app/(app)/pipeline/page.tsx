import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canDeleteLeads,
  canEditDispatch,
  type CalendarRow,
  type Lead,
  type LeadTask,
  type PipelineStageRow,
  type Profile,
} from "@/lib/data/types";
import { PipelineBoard } from "./pipeline-board";

export default async function PipelinePage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);
  const canDelete = canDeleteLeads(profile);

  const [{ data: leads }, { data: tasks }, { data: reps }, { data: stages }, { data: calendars }] =
    await Promise.all([
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase
        .from("lead_tasks")
        .select("id, lead_id, title, due_date, completed_at, assigned_to, created_at"),
      supabase
        .from("profiles")
        .select("id, name, email, phone, roles, status, can_delete_leads, created_at")
        .eq("status", "Active")
        .order("name", { ascending: true }),
      supabase.from("pipeline_stages").select("*").order("sort_order", { ascending: true }),
      supabase.from("calendars").select("*").order("sort_order", { ascending: true }),
    ]);

  return (
    <PipelineBoard
      leads={(leads as Lead[]) ?? []}
      tasks={(tasks as LeadTask[]) ?? []}
      reps={(reps as Profile[]) ?? []}
      stages={(stages as PipelineStageRow[]) ?? []}
      calendars={(calendars as CalendarRow[]) ?? []}
      canWrite={canWrite}
      canDelete={canDelete}
    />
  );
}
