import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import type {
  CalendarRow,
  DocumentRecord,
  Event,
  Job,
  Lead,
  LeadTask,
  PipelineStageRow,
} from "@/lib/data/types";
import { canEditSchedule } from "@/lib/data/types";
import { ScheduleList } from "./schedule-list";

export default async function SchedulePage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditSchedule(profile);
  const companyId = profile?.company_id ?? "";

  const [
    { data: events },
    { data: jobs },
    allReps,
    { data: leads },
    { data: stages },
    { data: leadTasks },
    { data: documents },
    { data: calendars },
  ] = await Promise.all([
    supabase.from("events").select("*").eq("company_id", companyId),
    supabase.from("jobs").select("*").eq("company_id", companyId).order("name", { ascending: true }),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase.from("leads").select("*").eq("company_id", companyId),
    supabase.from("pipeline_stages").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase
      .from("lead_tasks")
      .select("id, lead_id, title, due_date, completed_at, assigned_to, created_at")
      .eq("company_id", companyId),
    supabase.from("documents").select("*").eq("type", "Estimate").eq("company_id", companyId),
    supabase.from("calendars").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
  ]);
  const reps = allReps.filter((r) => r.status === "Active").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <ScheduleList
      events={(events as Event[]) ?? []}
      jobs={(jobs as Job[]) ?? []}
      reps={reps}
      leads={(leads as Lead[]) ?? []}
      stages={(stages as PipelineStageRow[]) ?? []}
      leadTasks={(leadTasks as LeadTask[]) ?? []}
      documents={(documents as DocumentRecord[]) ?? []}
      calendars={(calendars as CalendarRow[]) ?? []}
      canWrite={canWrite}
    />
  );
}
