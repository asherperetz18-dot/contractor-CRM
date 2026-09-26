/**
 * Notes shared between the team and the client (migration 0183).
 *
 * The lead's own Notes timeline (lead_notes) is internal and stays that
 * way. These live in their own table, lead_shared_notes, so the portal
 * can never read an internal note by forgetting a filter: the client's
 * page queries a table that only ever holds what the client may see.
 * See DECISIONS for why a separate table beats a "visible" flag.
 */

export type SharedNoteKind = "decision" | "selection" | "question" | "todo";
export type SharedNoteAuthor = "staff" | "client";

export type SharedNote = {
  id: string;
  lead_id: string;
  author_kind: SharedNoteAuthor;
  /** The staff author; null for the client's own notes. */
  author_id: string | null;
  body: string;
  kind: SharedNoteKind | null;
  pinned: boolean;
  answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  edited_at: string | null;
  /** When the team first opened a client's note; null until then. */
  staff_seen_at: string | null;
  created_at: string;
};

export const SHARED_NOTE_KINDS: SharedNoteKind[] = ["decision", "selection", "question", "todo"];

/** Tags the client can pick. A to-do is the team's to hand out. */
export const CLIENT_NOTE_KINDS: SharedNoteKind[] = ["decision", "selection", "question"];
/** Tags the team can pick. */
export const STAFF_NOTE_KINDS: SharedNoteKind[] = ["decision", "selection", "todo"];

export const MAX_NOTE_LENGTH = 4000;

export function kindLabel(kind: SharedNoteKind, audience: SharedNoteAuthor): string {
  switch (kind) {
    case "decision":
      return "Decision";
    case "selection":
      return "Selection";
    case "question":
      return "Question";
    case "todo":
      return audience === "client" ? "To-do for you" : "To-do for client";
  }
}

/** Plural for the filter chips. */
export function kindPlural(kind: SharedNoteKind): string {
  switch (kind) {
    case "decision":
      return "Decisions";
    case "selection":
      return "Selections";
    case "question":
      return "Questions";
    case "todo":
      return "To-dos";
  }
}

export function normalizeSharedNote(
  body: string,
  kind: string | null,
  author: SharedNoteAuthor
): { body: string; kind: SharedNoteKind | null } | { error: string } {
  const trimmed = body.trim();
  if (!trimmed) return { error: "Write a note first." };
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return { error: `Notes are limited to ${MAX_NOTE_LENGTH} characters.` };
  }
  if (kind === null || kind === "") return { body: trimmed, kind: null };
  const allowed = author === "client" ? CLIENT_NOTE_KINDS : STAFF_NOTE_KINDS;
  if (!allowed.includes(kind as SharedNoteKind)) return { error: "Pick one of the listed tags." };
  return { body: trimmed, kind: kind as SharedNoteKind };
}

/** Pinned first, then newest first. */
export function sortSharedNotes<T extends Pick<SharedNote, "pinned" | "created_at">>(notes: T[]): T[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });
}

export function kindCounts(notes: Pick<SharedNote, "kind">[]): Record<SharedNoteKind, number> {
  const counts: Record<SharedNoteKind, number> = { decision: 0, selection: 0, question: 0, todo: 0 };
  for (const n of notes) if (n.kind) counts[n.kind]++;
  return counts;
}

/**
 * Who hears about a client's new note: the office (Office/Admin) always,
 * and the rep the customer is assigned to. An unassigned customer's note
 * goes to the office alone rather than to every rep on the floor.
 */
export function seesClientNoteAlert(
  viewer: { id: string; roles: string[] },
  leadAssignedTo: string | null
): boolean {
  if (viewer.roles.includes("Office") || viewer.roles.includes("Admin")) return true;
  return leadAssignedTo !== null && leadAssignedTo === viewer.id;
}

const ALERT_BODY_MAX = 120;

export function clientNoteAlert(
  note: Pick<SharedNote, "kind" | "body">,
  clientName: string
): { title: string; body: string } {
  const text = note.kind ? `${kindLabel(note.kind, "staff")}: ${note.body}` : note.body;
  const flat = text.replace(/\s+/g, " ").trim();
  return {
    title: clientName ? `${clientName} added a note` : "A client added a note",
    body: flat.length > ALERT_BODY_MAX ? flat.slice(0, ALERT_BODY_MAX - 1).trimEnd() + "…" : flat,
  };
}

/**
 * Who may add, pin and answer shared notes -- the same roles the
 * database's insert and update policies name (Admin implied there).
 */
export function canWriteSharedNotes(profile: { roles: string[] }): boolean {
  return ["Office", "Sales", "Field", "Admin"].some((r) => profile.roles.includes(r));
}
