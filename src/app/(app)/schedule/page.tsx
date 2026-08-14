import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import type {
  CalendarRow,
  LinkedEstimate,
  Event,
  Job,
  Lead,
  LeadNote,
  LeadTask,
  PipelineStageRow,
} from "@/lib/data/types";
import { canDeleteAppointments, canEditSchedule } from "@/lib/data/types";
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
    leads,
    { data: stages },
    { data: leadTasks },
    { data: leadNotes },
    { data: estimates },
    { data: calendars },
  ] = await Promise.all([
    supabase.from("events").select("*").eq("company_id", companyId),
    supabase.from("jobs").select("*").eq("company_id", companyId).order("name", { ascending: true }),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    selectAll<Lead>((f, t) =>
      supabase.from("leads").select("*").eq("company_id", companyId).range(f, t)
    ),
    supabase.from("pipeline_stages").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase
      .from("lead_tasks")
      .select("id, lead_id, title, due_date, completed_at, assigned_to, created_at")
      .eq("company_id", companyId),
    supabase
      .from("lead_notes")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    // The estimates table, not the legacy documents one -- see the note
    // on the calendar page.
    supabase
      .from("estimates")
      .select("id, lead_id, doc_number, title, status, total_cents, issued_at, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
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
      leadNotes={(leadNotes as LeadNote[]) ?? []}
      estimates={(estimates as LinkedEstimate[]) ?? []}
      calendars={(calendars as CalendarRow[]) ?? []}
      canWrite={canWrite}
      canDeleteEvents={canDeleteAppointments(profile)}
    />
  );
}
