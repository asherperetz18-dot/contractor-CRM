import type { LeadFile, LeadNote, LeadTask } from "./data/types.ts";

type Lists = { tasks: LeadTask[]; notes: LeadNote[]; files: LeadFile[] };

/**
 * Lays a reloaded contact's tasks, notes and files over the open contact
 * window (DECISIONS #201). Only the three lists change: the lead stays
 * the same object, so the window's fields and drafts aren't re-seeded.
 * A reload that lands after the window closed or moved to another
 * contact, found nothing, or had a list fail (read as empty) changes
 * nothing.
 */
export function withFreshPanels<W extends { lead: { id: string } } & Lists>(
  open: W | null,
  fresh: ({ lead: { id: string }; listsFailed?: boolean } & Lists) | null
): W | null {
  if (!open || !fresh || fresh.lead.id !== open.lead.id || fresh.listsFailed) return open;
  return { ...open, tasks: fresh.tasks, notes: fresh.notes, files: fresh.files };
}
