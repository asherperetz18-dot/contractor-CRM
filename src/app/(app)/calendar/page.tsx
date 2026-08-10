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
import { canEditSchedule } from "@/lib/data/types";
import { CalendarBoard } from "./calendar-board";

export default async function CalendarPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditSchedule(profile);
  const companyId = profile?.company_id ?? "";

  const [
    { data: events },
    { data: jobs },
    allReps,
    leads,
    { data: leadTasks },
    { data: leadNotes },
    { data: estimates },
    { data: calendars },
    { data: stages },
  ] = await Promise.all([
    supabase.from("events").select("*").eq("company_id", companyId),
    supabase.from("jobs").select("*").eq("company_id", companyId).order("name", { ascending: true }),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    selectAll<Lead>((f, t) =>
      supabase.from("leads").select("*").eq("company_id", companyId).range(f, t)
    ),
    supabase
      .from("lead_tasks")
      .select("id, lead_id, title, due_date, completed_at, assigned_to, created_at")
      .eq("company_id", companyId),
    supabase
      .from("lead_notes")
      .select("id, lead_id, author_id, body, event_id, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    // The estimates table, not the legacy documents one. This tab used to
    // read documents where type = 'Estimate', which is a different feature
    // entirely -- so a lead with three real estimates against it showed
    // "no estimates yet".
    supabase
      .from("estimates")
      .select("id, lead_id, doc_number, title, status, total_cents, issued_at, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    supabase.from("calendars").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase.from("pipeline_stages").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
  ]);
  const reps = allReps.filter((r) => r.status === "Active").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <CalendarBoard
      events={(events as Event[]) ?? []}
      jobs={(jobs as Job[]) ?? []}
      reps={reps}
      leads={(leads as Lead[]) ?? []}
      leadTasks={(leadTasks as LeadTask[]) ?? []}
      leadNotes={(leadNotes as LeadNote[]) ?? []}
      estimates={(estimates as LinkedEstimate[]) ?? []}
      calendars={(calendars as CalendarRow[]) ?? []}
      stages={(stages as PipelineStageRow[]) ?? []}
      canWrite={canWrite}
    />
  );
}
