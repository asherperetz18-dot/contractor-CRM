import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import type {
  CalendarRow,
  DocumentRecord,
  Event,
  Job,
  Lead,
  LeadNote,
  LeadTask,
  PipelineStageRow,
  Profile,
} from "@/lib/data/types";
import { CalendarBoard } from "./calendar-board";

export default async function CalendarPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite =
    (profile?.roles.includes("Office") || profile?.roles.includes("Field")) ?? false;

  const [
    { data: events },
    { data: jobs },
    { data: reps },
    { data: leads },
    { data: leadTasks },
    { data: leadNotes },
    { data: documents },
    { data: calendars },
    { data: stages },
  ] = await Promise.all([
    supabase.from("events").select("*"),
    supabase.from("jobs").select("*").order("name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, name, email, phone, roles, status, created_at")
      .eq("status", "Active")
      .order("name", { ascending: true }),
    supabase.from("leads").select("*"),
    supabase
      .from("lead_tasks")
      .select("id, lead_id, title, due_date, completed_at, assigned_to, created_at"),
    supabase
      .from("lead_notes")
      .select("id, lead_id, author_id, body, event_id, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("documents").select("*").eq("type", "Estimate"),
    supabase.from("calendars").select("*").order("sort_order", { ascending: true }),
    supabase.from("pipeline_stages").select("*").order("sort_order", { ascending: true }),
  ]);

  return (
    <CalendarBoard
      events={(events as Event[]) ?? []}
      jobs={(jobs as Job[]) ?? []}
      reps={(reps as Profile[]) ?? []}
      leads={(leads as Lead[]) ?? []}
      leadTasks={(leadTasks as LeadTask[]) ?? []}
      leadNotes={(leadNotes as LeadNote[]) ?? []}
      documents={(documents as DocumentRecord[]) ?? []}
      calendars={(calendars as CalendarRow[]) ?? []}
      stages={(stages as PipelineStageRow[]) ?? []}
      canWrite={canWrite}
    />
  );
}
