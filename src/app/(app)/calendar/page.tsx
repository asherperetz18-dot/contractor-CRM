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
import { getAppointmentHolders, getLeadsBehindAppointments } from "@/lib/actions/dispatcher";
import { dispatcherPickerBootstrap } from "@/lib/data/dispatcher-bootstrap";
import { CalendarBoard } from "./calendar-board";

type LeadWithEvents = Lead & { events?: unknown };

/** Drops the join key so the client receives a plain Lead. */
function withoutJoin(rows: LeadWithEvents[] | null): Lead[] {
  return (rows ?? []).map((row) => {
    const lead = { ...row };
    delete lead.events;
    return lead as Lead;
  });
}

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
  // Leads standing behind appointments that RLS hides from this viewer,
  // so the appointment window's Photos/Notes/Result tabs exist for the
  // rep actually assigned to the visit. Empty for unscoped viewers.
  const behindAppointments = await getLeadsBehindAppointments();

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
    // Only the contacts an appointment actually points at.
    //
    // This used to be the whole book -- every lead in the company,
    // serialised into the page and sent to the browser to draw a week of
    // appointments. At 3,573 contacts that was 833kB of the response,
    // against 72 contacts that actually have an appointment. It is the
    // reason the calendar took seconds to appear while the server itself
    // answered in under half of one.
    //
    // Expressed as an inner join on events rather than a list of ids, so
    // it stays a single query and cannot outgrow the URL as the
    // appointment history builds up. The embedded events come back as a
    // key on each row and are dropped below -- the join is a filter here,
    // not data anyone reads.
    selectAll<LeadWithEvents>((f, t) =>
      supabase
        .from("leads")
        .select("*, events!inner(id)")
        .eq("company_id", companyId)
        .range(f, t)
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
      dispatcherPicker={dispatcherPickerBootstrap(profile, allReps)}
      leads={[...withoutJoin(leads), ...behindAppointments.leads]}
      leadTasks={(leadTasks as LeadTask[]) ?? []}
      leadNotes={[...((leadNotes as LeadNote[]) ?? []), ...behindAppointments.notes]}
      estimates={(estimates as LinkedEstimate[]) ?? []}
      calendars={(calendars as CalendarRow[]) ?? []}
      stages={(stages as PipelineStageRow[]) ?? []}
      canWrite={canWrite}
    />
  );
}
