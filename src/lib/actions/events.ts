"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import type { EventInput, EventStatus } from "@/lib/data/types";

// Confirmation flags are deliberately NOT in here -- they can be changed
// out-of-band by an inbound YES/NO text reply while the edit form sits
// open, so they're written separately and only when actually intended.
function toRow(input: EventInput) {
  return {
    title: input.title || null,
    date: input.date,
    time: input.time || null,
    end_time: input.end_time || null,
    event_type: input.event_type,
    status: input.status,
    assigned_to: input.assigned_to || null,
    second_assigned_to: input.second_assigned_to || null,
    job_id: input.job_id || null,
    notes: input.notes || null,
  };
}

export type ConfirmationTouched = { customer: boolean; rep: boolean };

function revalidateCalendarRoutes() {
  revalidatePath("/calendar");
  revalidatePath("/schedule");
  revalidatePath("/");
}

export async function createEvent(input: EventInput, leadId?: string) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const notesStamp = input.notes.trim()
    ? { notes_updated_by: profile.id, notes_updated_at: new Date().toISOString() }
    : {};
  const { error } = await supabase.from("events").insert({
    ...toRow(input),
    ...notesStamp,
    customer_confirmed: input.customer_confirmed,
    rep_confirmed: input.rep_confirmed,
    lead_id: leadId || null,
    created_by: profile.id,
    company_id: profile.company_id,
  });
  if (error) return { error: error.message };
  revalidateCalendarRoutes();
  return {};
}

export async function updateEvent(
  id: string,
  input: EventInput,
  confirmationTouched?: ConfirmationTouched
) {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const { data: existing } = await supabase.from("events").select("notes").eq("id", id).single();
  const notesChanged = (existing?.notes ?? "") !== (input.notes || "");
  const notesStamp =
    notesChanged && profile
      ? { notes_updated_by: profile.id, notes_updated_at: new Date().toISOString() }
      : {};
  // Only write a confirmation flag the user actually toggled. Otherwise a
  // form opened before a rep/client texted YES would save the stale value
  // and silently undo their reply.
  const confirmations = {
    ...(confirmationTouched?.customer ? { customer_confirmed: input.customer_confirmed } : {}),
    ...(confirmationTouched?.rep ? { rep_confirmed: input.rep_confirmed } : {}),
  };
  const { error } = await supabase
    .from("events")
    .update({ ...toRow(input), ...notesStamp, ...confirmations })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateCalendarRoutes();
  return {};
}

/**
 * Moves an appointment to a new date (and optionally time) without
 * touching anything else on it -- used by calendar drag-and-drop, where
 * the full edit payload isn't in hand.
 */
export async function rescheduleEvent(id: string, date: string, time?: string | null) {
  const supabase = await createClient();
  const patch: { date: string; time?: string | null } = { date };
  if (time !== undefined) patch.time = time;

  // Asks for the row back: an RLS-blocked update returns no error and
  // matches nothing, which would leave the chip sitting in its new slot
  // while the database still had the old date.
  const { data, error } = await supabase
    .from("events")
    .update(patch)
    .eq("id", id)
    .select("id, date, time");
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Couldn't move that appointment — your role may not have permission." };
  }
  revalidateCalendarRoutes();
  return {};
}

/**
 * Records the outcome of an appointment -- and only that. Deliberately
 * separate from updateEvent: logging a result shouldn't quietly commit
 * whatever else was half-typed in the open form.
 */
export async function setEventResult(id: string, status: EventStatus) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .update({ status })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Couldn't save that result — your role may not have permission." };
  }
  revalidateCalendarRoutes();
  return {};
}

export async function deleteEvent(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateCalendarRoutes();
  return {};
}

export async function markRepInfoSent(id: string, which: "primary" | "second") {
  const supabase = await createClient();
  const sentAt = new Date().toISOString();
  const update =
    which === "primary" ? { rep_info_sent_at: sentAt } : { second_rep_info_sent_at: sentAt };
  const { error } = await supabase.from("events").update(update).eq("id", id);
  if (error) return { error: error.message };
  revalidateCalendarRoutes();
  return { sentAt };
}
