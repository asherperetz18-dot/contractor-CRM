import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import type {
  DocumentRecord,
  Event,
  Job,
  Lead,
  LeadTask,
  PipelineStageRow,
  Profile,
} from "@/lib/data/types";
import { ScheduleList } from "./schedule-list";

export default async function SchedulePage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite =
    (profile?.roles.includes("Office") || profile?.roles.includes("Field")) ?? false;

  const [
    { data: events },
    { data: jobs },
    { data: reps },
    { data: leads },
    { data: stages },
    { data: leadTasks },
    { data: documents },
  ] = await Promise.all([
    supabase.from("events").select("*"),
    supabase.from("jobs").select("*").order("name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, name, email, phone, roles, status, created_at")
      .eq("status", "Active")
      .order("name", { ascending: true }),
    supabase.from("leads").select("*"),
    supabase.from("pipeline_stages").select("*").order("sort_order", { ascending: true }),
    supabase
      .from("lead_tasks")
      .select("id, lead_id, title, due_date, completed_at, assigned_to, created_at"),
    supabase.from("documents").select("*").eq("type", "Estimate"),
  ]);

  return (
    <ScheduleList
      events={(events as Event[]) ?? []}
      jobs={(jobs as Job[]) ?? []}
      reps={(reps as Profile[]) ?? []}
      leads={(leads as Lead[]) ?? []}
      stages={(stages as PipelineStageRow[]) ?? []}
      leadTasks={(leadTasks as LeadTask[]) ?? []}
      documents={(documents as DocumentRecord[]) ?? []}
      canWrite={canWrite}
    />
  );
}
