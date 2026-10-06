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
import { getAppointmentHolders, getLeadsBehindAppointments } from "@/lib/actions/dispatcher";
import { loadAppointmentContext } from "@/lib/data/appointment-context";
import { newestFirst, parseScheduleQuery, serverWindow } from "@/lib/schedule-window";
import { ScheduleList } from "./schedule-list";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; rep?: string; limit?: string }>;
}) {
  const query = parseScheduleQuery(await searchParams);
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditSchedule(profile);
  const companyId = profile?.company_id ?? "";

  // Only the window the list is showing (DECISIONS #143): the range and
  // rep in the address, a page at a time, newest first for history. This
  // page used to load every appointment the company ever booked, and
  // every task and note in the company, then filter in the browser.
  const bounds = serverWindow(query, new Date().toISOString().slice(0, 10));
  const ascending = !newestFirst(query.range, query.from);
  let events = supabase.from("events").select("*").eq("company_id", companyId);
  if (bounds.lo) events = events.gte("date", bounds.lo);
  if (bounds.hi) events = events.lte("date", bounds.hi);
  if (query.rep) events = events.or(`assigned_to.eq.${query.rep},second_assigned_to.eq.${query.rep}`);

  const [eventsResult, jobs, allReps, { data: stages }, { data: calendars }] = await Promise.all([
    // One more than a page, to know whether there is more.
    events
      .order("date", { ascending })
      .order("time", { ascending, nullsFirst: ascending })
      .order("id", { ascending })
      .range(0, query.limit),
    selectAll<Job>((f, t) =>
      supabase
        .from("jobs")
        .select("*")
        .eq("company_id", companyId)
        .order("name", { ascending: true })
        .range(f, t)
    ),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase.from("pipeline_stages").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    supabase.from("calendars").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
  ]);
  const rows = (eventsResult.data ?? []) as Event[];
  const loaded = rows.slice(0, query.limit);
  const hasMore = rows.length > query.limit;

  // The dates the page loaded, for the two service-role lookups behind
  // the appointment window: who holds each lead (resolved here so the
  // window is locked on the first frame), and the leads RLS hides from
  // this viewer, so the Photos/Notes/Result tabs exist for the rep
  // actually assigned to the visit.
  const dates = loaded.map((e) => e.date).sort();
  const span = dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
  const [appointmentHolders, behindAppointments] = span
    ? await Promise.all([getAppointmentHolders(span), getLeadsBehindAppointments(span)])
    : [{}, { leads: [], notes: [] }];

  // Only the contacts these appointments point at, with their tasks,
  // notes and estimates -- the appointment window's, for its own contact.
  const { leads, leadTasks, leadNotes, estimates } = await loadAppointmentContext(supabase, companyId, loaded);

  const reps = allReps.filter((r) => r.status === "Active").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <ScheduleList
      query={query}
      events={loaded}
      hasMore={hasMore}
      loadFailed={!!eventsResult.error}
      jobs={jobs}
      reps={reps}
      allMembers={allReps}
      leads={[...leads, ...behindAppointments.leads]}
      stages={(stages as PipelineStageRow[]) ?? []}
      leadTasks={leadTasks}
      leadNotes={[...leadNotes, ...behindAppointments.notes]}
      estimates={estimates}
      calendars={(calendars as CalendarRow[]) ?? []}
      canWrite={canWrite}
      canDeleteEvents={canDeleteAppointments(profile)}
      canAddNotes={canWriteLeadNotes(profile)}
      viewerId={profile?.id ?? null}
      viewerIsDispatchScoped={isDispatchScoped(profile)}
      appointmentHolders={appointmentHolders}
    />
  );
}
