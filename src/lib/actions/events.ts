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

export type ConfirmationTouched = { customer: boolean; rep: boolean; status?: boolean };

/**
 * What the server currently holds for the three fields a text message can
 * change underneath an open form.
 *
 * The calendar renders once. A rep or customer replying YES a minute
 * later changes the row, and the appointment somebody then opens still
 * shows what the page loaded -- which is how a confirmed appointment sat
 * there reading "Unconfirmed" while the database said otherwise.
 */
export async function getEventLiveState(
  eventId: string
): Promise<{ customer_confirmed: boolean; rep_confirmed: boolean; status: EventStatus } | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("customer_confirmed, rep_confirmed, status")
    .eq("id", eventId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ customer_confirmed: boolean; rep_confirmed: boolean; status: EventStatus }>();
  return data ?? null;
}

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

/**
 * Clears the follow-up stamps when an appointment moves to a new slot.
 *
 * The no-show cron chases an appointment once and records that it did:
 * result_reminder_sent_at, followup_flagged_at, followup_moved_at. Those
 * stamps used to survive a reschedule, which quietly disabled the chase
 * forever -- an appointment chased on Monday and then moved to Thursday
 * looked "already handled", so the rep was never reminded to log its
 * result. It failed silently and only surfaced as "I never got a text".
 *
 * A moved appointment is a new occurrence, so it starts over.
 */
function rescheduleResets(
  before: { date: string; time: string | null } | null,
  date: string,
  time: string | null | undefined
) {
  if (!before) return {};
  const timeChanged = time !== undefined && (time ?? null) !== (before.time ?? null);
  if (before.date === date && !timeChanged) return {};
  return {
    result_reminder_sent_at: null,
    followup_flagged_at: null,
    followup_moved_at: null,
  };
}

export async function updateEvent(
  id: string,
  input: EventInput,
  confirmationTouched?: ConfirmationTouched
) {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("events")
    .select("notes, date, time")
    .eq("id", id)
    .single();
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
  const row = toRow(input);
  // Status joins the confirmation flags in only being written when somebody
  // actually chose it. A customer's YES now sets the status as well as the
  // flag, so a form opened beforehand and saved afterwards would have
  // quietly put a Confirmed appointment back to New -- undoing the reply
  // through a field nobody touched.
  if (confirmationTouched && !confirmationTouched.status) {
    delete (row as { status?: unknown }).status;
  }
  const { error } = await supabase
    .from("events")
    .update({
      ...row,
      ...notesStamp,
      ...confirmations,
      ...rescheduleResets(
        existing as { date: string; time: string | null } | null,
        (row as { date: string }).date,
        (row as { time?: string | null }).time
      ),
    })
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
  const { data: before } = await supabase
    .from("events")
    .select("date, time")
    .eq("id", id)
    .maybeSingle<{ date: string; time: string | null }>();

  const patch: {
    date: string;
    time?: string | null;
    result_reminder_sent_at?: null;
    followup_flagged_at?: null;
    followup_moved_at?: null;
  } = { date, ...rescheduleResets(before ?? null, date, time) };
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

  /**
   * A Showed or a Won has to carry a job value.
   *
   * Enforced here rather than only in the form, because a disabled
   * button is a suggestion -- this is the rule. Every money figure on
   * the pipeline sums leads.value, so a visit marked Showed with nothing
   * against it quietly reads as a slow month rather than as missing
   * data. A Won worth nothing is the same hole, wider: the one outcome
   * that definitely has a number attached.
   *
   * Not the failures. There is nothing to price on a no-show, and
   * demanding a number there would only produce zeros.
   */
  if (status === "Showed" || status === "Won") {
    const { data: withLead } = await supabase
      .from("events")
      .select("lead_id, leads(value)")
      .eq("id", id)
      .maybeSingle<{ lead_id: string | null; leads: { value: number } | null }>();
    if (withLead?.lead_id && !((withLead.leads?.value ?? 0) > 0)) {
      return {
        error: `Enter the estimated job value before marking this appointment as ${status}.`,
      };
    }
  }

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
  // .select() so a delete the policy refused surfaces as an error rather
  // than as silence. Without it this matched zero rows and returned
  // success, and the caller closed the dialog -- so a dispatcher pressing
  // Delete was told the appointment was gone while it was still there.
  const { data, error } = await supabase
    .from("events")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) {
    return { error: "That appointment couldn't be deleted — your role may not have permission." };
  }
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
