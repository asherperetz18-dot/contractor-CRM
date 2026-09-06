/**
 * The note on one checklist step -- "gate code 4432", "inspector wants
 * the panel photo first".
 *
 * One line of free text per step, saved when the box loses focus. The
 * rules live here (rather than in the action or the component) so the
 * screen and the server agree on what a note is: the same trim, the same
 * ceiling, and the same reading of the error Postgres returns before the
 * column exists.
 */

/** Longer than any note anyone types on a row this size. */
export const MAX_CHECKLIST_NOTE = 500;

/**
 * What actually gets stored. Blank -- or nothing but spaces -- is null,
 * not an empty string, so "no note" has one representation. The field is
 * one line, so a pasted paragraph is folded onto one.
 */
export function cleanChecklistNote(input: string | null | undefined): string | null {
  if (input == null) return null;
  const oneLine = input.replace(/\s+/g, " ").trim();
  return oneLine ? oneLine.slice(0, MAX_CHECKLIST_NOTE) : null;
}

/**
 * True when the save failed only because migration 0128 has not been run
 * yet. Postgres and PostgREST word it differently, hence both forms.
 */
export function isMissingNoteColumn(message: string): boolean {
  const m = message.toLowerCase();
  if (!m.includes("'note'") && !m.includes('"note"')) return false;
  return m.includes("schema cache") || m.includes("does not exist") || m.includes("no column");
}

/** Shown in place of that error, because it names the fix. */
export const RUN_NOTE_MIGRATION =
  "Notes are not switched on yet — run supabase/migrations/0128_checklist_item_notes.sql in the Supabase SQL editor, then try again.";
