import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import type { CalendarRow, Event, Job, PipelineStageRow } from "@/lib/data/types";
import {
  canDeleteAppointments,
  canEditSchedule,
  canWriteLeadNotes,
  isDispatchScoped,
} from "@/lib/data/types";
import { monthOf, monthRange, parseMonthParam } from "@/lib/calendar-range";
import { loadAppointmentContext } from "@/lib/data/appointment-context";
import { getAppointmentHolders, getLeadsBehindAppointments } from "@/lib/actions/dispatcher";
import { CalendarBoard } from "./calendar-board";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; openEvent?: string }>;
}) {
  const { month: monthParam, openEvent } = await searchParams;
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditSchedule(profile);
  const companyId = profile?.company_id ?? "";

  // One month at a time, plus a week either side (DECISIONS #142): the
  // one in the address, else this month. This page used to read every
  // appointment the company ever booked, and every contact, task and
  // note behind them, on every visit.
  //
  // A link to one appointment (the contact card, a reminder, search)
  // opens on that appointment's month, so the appointment and its
  // contact are on the page for as long as its window is open.
  let month = parseMonthParam(monthParam);
  if (openEvent && UUID.test(openEvent)) {
    const { data } = await supabase
      .from("events")
      .select("date")
      .eq("company_id", companyId)
      .eq("id", openEvent)
      .maybeSingle<{ date: string }>();
    const eventDate = data?.date;
    if (eventDate) month = monthOf(eventDate);
  }
  // UTC, as the board's own "today" is.
  month ??= monthOf(new Date().toISOString().slice(0, 10));
  const range = monthRange(month);

  // Resolved here, not in the appointment window: the lock has to be
  // right on the first frame, and only the service role can see who
  // holds a lead this dispatcher is scoped out of. Returns {} for
  // everyone the restriction doesn't apply to, so no extra work runs.
  const appointmentHolders = await getAppointmentHolders(range);
  // Leads standing behind appointments that RLS hides from this viewer,
  // so the appointment window's Photos/Notes/Result tabs exist for the
  // rep actually assigned to the visit. Empty for unscoped viewers.
  const behindAppointments = await getLeadsBehindAppointments(range);

  const [events, jobs, allReps, { data: calendars }, { data: stages }] = await Promise.all([
    // selectAll: a bare select stops at 1000 rows in silence -- see the
    // schedule page's note on the same shape. At stress-tenant volume
    // (1,100 events here) a bare select was quietly dropping the newest
    // 100 appointments off the calendar.
    selectAll<Event>((f, t) =>
      supabase.from("events").select("*").eq("company_id", companyId).gte("date", range.from).lte("date", range.to).range(f, t)
    ),
    selectAll<Job>((f, t) =>
      supabase
        .from("jobs")
        .select("*")
        .eq("company_id", companyId)
        .order("name", { ascending: true })
        .range(f, t)
    ),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase.from("calendars").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase.from("pipeline_stages").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
  ]);

  // Only the contacts these appointments point at, and their tasks,
  // notes and estimates -- all of which only the appointment window
  // reads, for the one contact its visit belongs to. They used to arrive
  // for every contact that had ever had an appointment.
  const { leads, leadTasks, leadNotes, estimates } = await loadAppointmentContext(supabase, companyId, events);

  // Everyone active. This is the list the board resolves names from and
  // the appointment form assigns to, so it must stay whole: narrowing it
  // left every dispatcher in the filter reading "Unnamed", because their
  // names are looked up here -- and quietly removed office staff from the
  // list of people an appointment can be booked to.
  const reps = allReps
    .filter((r) => r.status === "Active")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <CalendarBoard
      events={events}
      jobs={jobs}
      reps={reps}
      allMembers={allReps}
      month={month}
      canDeleteEvents={canDeleteAppointments(profile)}
      canAddNotes={canWriteLeadNotes(profile)}
      viewerId={profile?.id ?? null}
      viewerIsDispatchScoped={isDispatchScoped(profile)}
      appointmentHolders={appointmentHolders}
      leads={[...leads, ...behindAppointments.leads]}
      leadTasks={leadTasks}
      leadNotes={[...leadNotes, ...behindAppointments.notes]}
      estimates={estimates}
      calendars={(calendars as CalendarRow[]) ?? []}
      stages={(stages as PipelineStageRow[]) ?? []}
      canWrite={canWrite}
    />
  );
}
