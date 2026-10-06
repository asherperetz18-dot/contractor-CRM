import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { selectAll } from "./select-all";
import type { Event, Lead, LeadNote, LeadTask, LinkedEstimate } from "./types";

/**
 * What the appointment window needs behind a set of appointments: their
 * contacts, and those contacts' tasks, notes and estimates -- for the
 * Calendar's month and the Schedule's window (DECISIONS #142, #143).
 * Both pages used to load these for every contact that had ever had an
 * appointment; the window only ever reads the one contact its visit
 * belongs to.
 *
 * Read as the signed-in person, so row level security narrows them as
 * always (contacts RLS hides come from getLeadsBehindAppointments).
 */

type Db = Awaited<ReturnType<typeof createClient>>;

/** How many ids go in one in() filter, so a busy window can't outgrow the request URL. */
const IN_CHUNK = 150;

/** Rows for every chunk of ids, each chunk read in full. */
async function forChunks<T>(ids: string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(...(await read(ids.slice(i, i + IN_CHUNK))));
  return out;
}

const newestFirst = <T extends { created_at: string }>(rows: T[]) =>
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));

export async function loadAppointmentContext(
  supabase: Db,
  companyId: string,
  events: Pick<Event, "lead_id">[]
): Promise<{ leads: Lead[]; leadTasks: LeadTask[]; leadNotes: LeadNote[]; estimates: LinkedEstimate[] }> {
  const leadIds = [...new Set(events.map((e) => e.lead_id).filter((id): id is string => !!id))];
  const [leads, leadTasks, leadNotes, estimates] = await Promise.all([
    forChunks(leadIds, (chunk) =>
      selectAll<Lead>((f, t) => supabase.from("leads").select("*").eq("company_id", companyId).in("id", chunk).range(f, t))
    ),
    forChunks(leadIds, (chunk) =>
      selectAll<LeadTask>((f, t) =>
        supabase
          .from("lead_tasks")
          .select("id, lead_id, title, due_date, completed_at, assigned_to, created_by, created_at")
          .eq("company_id", companyId)
          .in("lead_id", chunk)
          .range(f, t)
      )
    ),
    forChunks(leadIds, (chunk) =>
      selectAll<LeadNote>((f, t) =>
        supabase
          .from("lead_notes")
          .select("id, lead_id, author_id, body, event_id, created_at")
          .eq("company_id", companyId)
          .in("lead_id", chunk)
          .order("created_at", { ascending: false })
          .range(f, t)
      )
    ).then(newestFirst),
    // The estimates table, not the legacy documents one. The window's tab
    // used to read documents where type = 'Estimate', which is a different
    // feature entirely -- so a lead with three real estimates against it
    // showed "no estimates yet".
    forChunks(leadIds, (chunk) =>
      selectAll<LinkedEstimate>((f, t) =>
        supabase
          .from("estimates")
          .select("id, lead_id, doc_number, title, status, total_cents, issued_at, created_at")
          .eq("company_id", companyId)
          .in("lead_id", chunk)
          .order("created_at", { ascending: false })
          .range(f, t)
      )
    ).then(newestFirst),
  ]);
  return { leads, leadTasks, leadNotes, estimates };
}
