import { moneyCents, type EstimateStatus } from "./data/types.ts";

/**
 * The question the contact window's Delete asks (DECISIONS #200). It used
 * to ask nothing when nothing was typed, and one click removed the
 * contact with its estimates, signed contracts, tasks, notes and files.
 *
 * The counts are what the window loaded. `estimates: null` is a viewer
 * who can't see estimates: the question still warns, without counting
 * them or showing their money.
 */
export function contactDeleteConfirm(c: {
  name: string;
  estimates: { status: EstimateStatus }[] | null;
  paidCents: number;
  tasks: number;
  notes: number;
  files: number;
  draftsWaiting: boolean;
}): string {
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (c.estimates === null) {
    parts.push("any estimates or contracts");
  } else if (c.estimates.length > 0) {
    const signed = c.estimates.filter((e) => e.status === "Signed").length;
    const detail = [signed ? `${signed} signed` : "", c.paidCents > 0 ? `${moneyCents(c.paidCents)} paid` : ""].filter(Boolean);
    parts.push(count(c.estimates.length, "estimate") + (detail.length ? ` (${detail.join(", ")})` : ""));
  }
  if (c.tasks) parts.push(count(c.tasks, "task"));
  if (c.notes) parts.push(count(c.notes, "note"));
  if (c.files) parts.push(count(c.files, "file"));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];

  return [
    `Delete ${c.name}?`,
    [
      list ? `This also deletes ${list}.` : "",
      "Appointments and texts stay, but lose their link to this contact.",
    ]
      .filter(Boolean)
      .join(" "),
    // Settings → Trash is Office/Admin only, even for a Sales rep allowed
    // to delete (TECH_DEBT); 30 is lead-trash.ts's TRASH_RETENTION_DAYS.
    "An Office or Admin user can restore it from Settings → Trash for 30 days.",
    c.draftsWaiting ? "What you've typed on this contact is discarded too." : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
