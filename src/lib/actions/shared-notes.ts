"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canWriteSharedNotes,
  MAX_NOTE_LENGTH,
  normalizeSharedNote,
  type SharedNote,
} from "@/lib/data/shared-notes";

/**
 * The team's side of the notes shared with a client (migration 0183).
 * Every call runs on the caller's own session, so RLS decides what they
 * may read and write; the role check here only turns a refusal into a
 * plain sentence before the round trip.
 */

const COLUMNS =
  "id, lead_id, author_kind, author_id, body, kind, pinned, answer, answered_by, answered_at, edited_at, staff_seen_at, created_at";

/**
 * A lead's shared notes. `notes` is null when the table isn't there yet
 * (migration 0183 not run), so the lead card can say so instead of
 * showing an empty list that looks like "no notes".
 *
 * Opening the list marks the client's unseen notes as seen. The rows
 * come back as they were before that, so the notes that were new still
 * say New this once.
 */
export async function getSharedNotes(leadId: string): Promise<{
  notes: SharedNote[] | null;
  /** May this person add, pin and answer (Office/Sales/Field/Admin). */
  canWrite: boolean;
  /** The caller's own id, so the panel offers Edit on their notes only. */
  me: string | null;
  error?: string;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { notes: null, canWrite: false, me: null, error: "Not signed in." };
  const canWrite = canWriteSharedNotes(profile);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_shared_notes")
    .select(COLUMNS)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) return { notes: null, canWrite, me: profile.id };

  const notes = (data ?? []) as SharedNote[];
  if (canWrite && notes.some((n) => n.author_kind === "client" && !n.staff_seen_at)) {
    await supabase
      .from("lead_shared_notes")
      .update({ staff_seen_at: new Date().toISOString() })
      .eq("lead_id", leadId)
      .eq("author_kind", "client")
      .is("staff_seen_at", null);
  }
  return { notes, canWrite, me: profile.id };
}

export async function addSharedNote(
  leadId: string,
  body: string,
  kind: string | null
): Promise<{ error?: string }> {
  const note = normalizeSharedNote(body, kind, "staff");
  if ("error" in note) return { error: note.error };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canWriteSharedNotes(profile)) return { error: "Your role can read shared notes but not add them." };

  const supabase = await createClient();
  const { error } = await supabase.from("lead_shared_notes").insert({
    company_id: profile.company_id,
    lead_id: leadId,
    author_kind: "staff",
    author_id: profile.id,
    body: note.body,
    kind: note.kind,
  });
  if (error) return { error: "Couldn't share that note — your role may not have permission." };

  revalidatePath("/portal/home");
  return {};
}

/** Staff may reword only their own notes; the database enforces it too. */
export async function editSharedNote(id: string, body: string): Promise<{ error?: string }> {
  const trimmed = body.trim();
  if (!trimmed) return { error: "A note can't be empty." };
  if (trimmed.length > MAX_NOTE_LENGTH) return { error: `Notes are limited to ${MAX_NOTE_LENGTH} characters.` };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_shared_notes")
    .update({ body: trimmed, edited_at: new Date().toISOString() })
    .eq("id", id)
    .eq("author_id", profile.id)
    .select("id");
  if (error || !data?.length) return { error: "Only the person who wrote a note can edit it." };

  revalidatePath("/portal/home");
  return {};
}

export async function setSharedNotePinned(id: string, pinned: boolean): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canWriteSharedNotes(profile)) return { error: "Your role can't pin shared notes." };

  const supabase = await createClient();
  const { error } = await supabase.from("lead_shared_notes").update({ pinned }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/portal/home");
  return {};
}

/**
 * Answers a client's question. The answer text is optional: "Mark
 * answered" with nothing typed just closes the question.
 */
export async function answerSharedNote(id: string, answer: string): Promise<{ error?: string }> {
  const trimmed = answer.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) return { error: `Answers are limited to ${MAX_NOTE_LENGTH} characters.` };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canWriteSharedNotes(profile)) return { error: "Your role can't answer shared notes." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("lead_shared_notes")
    .update({ answer: trimmed || null, answered_by: profile.id, answered_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/portal/home");
  return {};
}
