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
import {
  canDeleteAppointments,
  canEditSchedule,
  canWriteLeadNotes,
  isDispatchScoped,
} from "@/lib/data/types";
import { getAppointmentHolders } from "@/lib/actions/dispatcher";
import { CalendarBoard } from "./calendar-board";

export default async function CalendarPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditSchedule(profile);
  const companyId = profile?.company_id ?? "";
  // Resolved here, not in the appointment window: the lock has to be
  // right on the first frame, and only the service role can see who
  // holds a lead this dispatcher is scoped out of. Returns {} for
  // everyone the restriction doesn't apply to, so no extra work runs.
  const appointmentHolders = await getAppointmentHolders();

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
  // Who is actually on the calendar, past or future.
  const onCalendar = new Set<string>();
  for (const e of ((events as Event[]) ?? [])) {
    if (e.assigned_to) onCalendar.add(e.assigned_to);
    if (e.second_assigned_to) onCalendar.add(e.second_assigned_to);
  }

  // Everyone active. This is the list the board resolves names from and
  // the appointment form assigns to, so it must stay whole: narrowing it
  // left every dispatcher in the filter reading "Unnamed", because their
  // names are looked up here -- and quietly removed office staff from the
  // list of people an appointment can be booked to.
  const reps = allReps
    .filter((r) => r.status === "Active")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  // The narrowed list, for the rep filter only. It listed every active
  // member, so bookkeepers, dispatchers, the shared phone account and
  // anyone added for any other reason all appeared as reps -- sixteen
  // names, ten of whom could ever match an appointment.
  //
  // Two ways in, because either alone is wrong. Role alone drops somebody
  // in dispatch who is running an appointment anyway, and their booking
  // becomes unreachable through the filter. Appointments alone hides a
  // newly hired rep until their first booking, so they look missing on
  // the day they need to be picked.
  const filterReps = reps.filter((r) => r.roles?.includes("Sales") || onCalendar.has(r.id));

  return (
    <CalendarBoard
      events={(events as Event[]) ?? []}
      jobs={(jobs as Job[]) ?? []}
      reps={reps}
      filterReps={filterReps}
      canDeleteEvents={canDeleteAppointments(profile)}
      canAddNotes={canWriteLeadNotes(profile)}
      viewerId={profile?.id ?? null}
      viewerIsDispatchScoped={isDispatchScoped(profile)}
      appointmentHolders={appointmentHolders}
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
