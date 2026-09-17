/**
 * The quick chips on a job row (Projects table and crew cards), colored
 * by what they mean so the row is scanned by color before it's read:
 *
 *   green  = money coming IN   (the contract, its change orders)
 *   red    = money going OUT   (+ Add bill, the job's bills)
 *   blue   = progress          (the checklist)
 *   indigo = the paperwork pile (permits & files)
 *   purple = photos · rose = the client · slate = the printed report
 *
 * Both views read this map instead of hardcoding classes, so the office
 * table and the crew cards can't drift apart, and a new chip has to
 * pick a meaning before it picks a color. The CSS behind each class
 * lives in `globals.css` next to `.proj-check-chip`.
 */

export type JobChipKind =
  | "checklist"
  | "contract"
  | "changeOrder"
  | "addBill"
  | "bills"
  | "permits"
  | "photos"
  | "client"
  | "report";

/** Cluster order on the row: what's left to do, then the money story
 *  (in before out), then the job's records and links. */
export type JobChipGroup = "progress" | "moneyIn" | "moneyOut" | "records";

export const JOB_CHIP_GROUP_ORDER: readonly JobChipGroup[] = [
  "progress",
  "moneyIn",
  "moneyOut",
  "records",
];

const CHIP_GROUP: Record<JobChipKind, JobChipGroup> = {
  checklist: "progress",
  contract: "moneyIn",
  changeOrder: "moneyIn",
  addBill: "moneyOut",
  bills: "moneyOut",
  permits: "records",
  photos: "records",
  client: "records",
  report: "records",
};

// The checklist keeps the bare base class: blue at rest, with the
// -done / -overdue modifiers layered on by the component.
const CHIP_COLOR: Record<JobChipKind, string> = {
  checklist: "",
  contract: "proj-chip-in",
  changeOrder: "proj-chip-in",
  // The one chip that CREATES a record instead of opening one: same
  // red as Bills (both are money out), but dashed — the add affordance
  // — so "+ Add bill" and "Bills" can't be mistaken for twins.
  addBill: "proj-chip-out proj-chip-add",
  bills: "proj-chip-out",
  permits: "proj-chip-paper",
  photos: "proj-photo-chip",
  client: "proj-client-chip",
  report: "proj-chip-report",
};

export function jobChipGroup(kind: JobChipKind): JobChipGroup {
  return CHIP_GROUP[kind];
}

export function jobChipClass(kind: JobChipKind): string {
  const color = CHIP_COLOR[kind];
  return color ? `proj-check-chip ${color}` : "proj-check-chip";
}
