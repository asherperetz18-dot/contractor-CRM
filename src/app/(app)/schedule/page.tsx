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
import { ScheduleList } from "./schedule-list";

type LeadWithEvents = Lead & { events?: unknown };

/** Drops the join key so the client receives a plain Lead. */
function withoutJoin(rows: LeadWithEvents[] | null): Lead[] {
  return (rows ?? []).map((row) => {
    const lead = { ...row };
    delete lead.events;
    return lead as Lead;
  });
}

export default async function SchedulePage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditSchedule(profile);
  const companyId = profile?.company_id ?? "";
  // See the calendar page: resolved server-side so the appointment
  // window is locked on the first frame rather than a beat later.
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
    { data: stages },
    { data: leadTasks },
    { data: leadNotes },
    { data: estimates },
    { data: calendars },
  ] = await Promise.all([
    // selectAll: a bare select stops at 1000 rows in silence, and a
    // schedule that quietly drops the newest appointments once the
    // history passes a thousand is exactly the page nobody would
    // suspect. Wrapped to keep the destructuring shape.
    selectAll<Event>((f, t) =>
      supabase.from("events").select("*").eq("company_id", companyId).range(f, t)
    ).then((rows) => ({ data: rows })),
    supabase.from("jobs").select("*").eq("company_id", companyId).order("name", { ascending: true }),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    // Only the contacts an appointment actually points at, matching the
    // calendar. This page was loading every lead in the company and
    // sending them all to the browser to render a list of appointments;
    // the only thing that reads them is the appointment window, looking
    // up the one contact its own visit belongs to.
    //
    // An inner join on events rather than a list of ids, so it stays one
    // query and cannot outgrow the request URL as the appointment
    // history builds up. The embedded events are the filter, not data
    // anyone reads, and are dropped below.
    selectAll<LeadWithEvents>((f, t) =>
      supabase
        .from("leads")
        .select("*, events!inner(id)")
        .eq("company_id", companyId)
        .range(f, t)
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
      leads={[...withoutJoin(leads), ...behindAppointments.leads]}
      stages={(stages as PipelineStageRow[]) ?? []}
      leadTasks={(leadTasks as LeadTask[]) ?? []}
      leadNotes={[...((leadNotes as LeadNote[]) ?? []), ...behindAppointments.notes]}
      estimates={(estimates as LinkedEstimate[]) ?? []}
      calendars={(calendars as CalendarRow[]) ?? []}
      canWrite={canWrite}
      canDeleteEvents={canDeleteAppointments(profile)}
      canAddNotes={canWriteLeadNotes(profile)}
      viewerId={profile?.id ?? null}
      viewerIsDispatchScoped={isDispatchScoped(profile)}
      appointmentHolders={appointmentHolders}
      dispatcherPicker={dispatcherPickerBootstrap(profile, allReps)}
    />
  );
}
