import {
  FALLBACK_STAGE_COLOR,
  NO_DISPOSITION,
  SYSTEM_STAGE_NAMES,
} from "@/lib/data/types";

/**
 * The starter lists a brand new company opens with.
 *
 * A company with no rows in these tables is not a blank slate, it is a
 * broken app: the Pipeline board draws one column per pipeline_stages row
 * (app/(app)/pipeline/page.tsx passes `stages ?? []` straight through), so
 * zero rows means zero columns, an empty calendar picker and empty
 * dropdowns on the lead form.
 *
 * createCompany() solves that by copying the creator's current company,
 * which works when an existing admin makes the company and not at all
 * when a stranger signs up and pays -- there is no company to copy from.
 * Hence a fixed set here.
 *
 * The names, colours and rules are the ones the seed migrations
 * established (0008 stages, 0012 calendars, 0013 dispositions, 0048
 * "Not Interested", 0091 disposition rules) and that every company on the
 * system still shares; the per-business extras ("Meta", "Roy Leads", ...)
 * are deliberately left out. Everything is editable in Settings
 * afterwards, except the is_system rows, which the app relies on by name.
 *
 * Colours are quoted from those migrations rather than picked, because a
 * self-serve company and an admin-created one drawing the same board in
 * different colours is a difference nobody can explain.
 */

export type DefaultStageRow = { name: string; color: string; sort_order: number; is_system: boolean };
export type DefaultCalendarRow = DefaultStageRow;
export type DefaultDispositionRow = DefaultStageRow & {
  move_to_stage: string | null;
  creates_followup_task: boolean;
};
export type DefaultSimpleRow = { name: string; sort_order: number };

// is_system is derived, not retyped. It marks the stages the app itself
// moves leads into -- Unsorted for anything unrecognised, Appointment
// Scheduled when an appointment is booked, Won/Lost at the end -- and
// lib/actions/pipeline-stages.ts refuses to rename or delete them by
// consulting this same list. A fifth protected stage added there would
// otherwise arrive unprotected in every new company.
const STAGES: { name: string; color: string }[] = [
  { name: "Unsorted", color: FALLBACK_STAGE_COLOR },
  { name: "New Lead", color: "#7C8798" },
  { name: "No Answer", color: "#B7862B" },
  { name: "Contacted", color: "#2D5F8A" },
  { name: "Appointment Scheduled", color: "#C7691B" },
  { name: "Appointment Follow Up", color: "#C7691B" },
  { name: "2nd Appointment", color: "#C7691B" },
  { name: "Estimate Prepared", color: "#2D5F8A" },
  { name: "Proposal Sent", color: "#2D5F8A" },
  { name: "Pending Finance", color: "#B7862B" },
  { name: "Close to Sale", color: "#B7862B" },
  { name: "Won", color: "#2F855A" },
  { name: "Lost", color: "#C0392B" },
  // 0048 seeded this one at #ea2610 for every existing company.
  { name: "Not Interested", color: "#ea2610" },
  // 0008 seeded DNC at #C0392B. The disposition of the same name is a
  // different row in a different table and a different colour -- easy to
  // cross, so both are quoted from their own migration.
  { name: "DNC", color: "#C0392B" },
];

export const DEFAULT_PIPELINE_STAGES: DefaultStageRow[] = STAGES.map((stage, index) => ({
  ...stage,
  sort_order: index + 1,
  is_system: SYSTEM_STAGE_NAMES.includes(stage.name),
}));

export const DEFAULT_CALENDARS: DefaultCalendarRow[] = [
  { name: "Estimate", color: "#2D5F8A", sort_order: 1, is_system: false },
  { name: "Job Visit", color: "#2F855A", sort_order: 2, is_system: false },
  { name: "Meeting", color: "#C7691B", sort_order: 3, is_system: false },
  { name: "Other", color: "#7C8798", sort_order: 4, is_system: false },
];

/**
 * Dispositions carry their rules, not just their names.
 *
 * move_to_stage is what makes the dialer's buttons do anything: without
 * it lib/actions/call-logs.ts writes the outcome onto the call log and
 * leaves the lead where it was, which reads as a broken button -- the
 * exact complaint migration 0091 was written to fix. Seeding the names
 * without the rules would have handed every self-serve company that bug
 * back.
 *
 * The mapping is 0091's, including its one deliberate omission: "Sale /
 * Won" moves nothing, because Won is what a signed contract makes true,
 * not what a phone call says.
 */
export const DEFAULT_CALL_DISPOSITIONS: DefaultDispositionRow[] = [
  { name: NO_DISPOSITION, color: FALLBACK_STAGE_COLOR, sort_order: 1, is_system: true, move_to_stage: null, creates_followup_task: false },
  { name: "Connected", color: "#2D5F8A", sort_order: 2, is_system: false, move_to_stage: "Contacted", creates_followup_task: false },
  { name: "Sale / Won", color: "#2F855A", sort_order: 3, is_system: false, move_to_stage: null, creates_followup_task: false },
  // A callback nobody is reminded of is a lost lead -- 0091's words.
  { name: "Callback", color: "#C7691B", sort_order: 4, is_system: false, move_to_stage: "Contacted", creates_followup_task: true },
  { name: "Appointment Set", color: "#6B4FA0", sort_order: 5, is_system: false, move_to_stage: "Appointment Scheduled", creates_followup_task: false },
  { name: "Left Voicemail", color: "#4A90A4", sort_order: 6, is_system: false, move_to_stage: "No Answer", creates_followup_task: false },
  { name: "No Answer", color: "#B7862B", sort_order: 7, is_system: false, move_to_stage: "No Answer", creates_followup_task: false },
  { name: "Not Interested", color: "#C0392B", sort_order: 8, is_system: false, move_to_stage: "Not Interested", creates_followup_task: false },
  { name: "Wrong Number", color: "#7C8798", sort_order: 9, is_system: false, move_to_stage: "DNC", creates_followup_task: false },
  { name: "Other", color: FALLBACK_STAGE_COLOR, sort_order: 10, is_system: false, move_to_stage: null, creates_followup_task: false },
];

// Kept short on purpose. Trades differ far more than pipelines do, and a
// roofer should not have to delete "Kitchen Cabinets" before adding their
// own -- these four are only here so the dropdown is never empty.
export const DEFAULT_PROJECT_TYPES: DefaultSimpleRow[] = [
  { name: "Kitchen Remodel", sort_order: 1 },
  { name: "Bathroom Remodel", sort_order: 2 },
  { name: "Kitchen Cabinets", sort_order: 3 },
  { name: "Roofing", sort_order: 4 },
];

export const DEFAULT_LEAD_SOURCES: DefaultSimpleRow[] = [
  { name: "Website", sort_order: 1 },
  { name: "Google", sort_order: 2 },
  { name: "Facebook", sort_order: 3 },
  { name: "Referral", sort_order: 4 },
  { name: "Cold Call", sort_order: 5 },
  { name: "Repeat Customer", sort_order: 6 },
  { name: "CSV Import", sort_order: 7 },
  { name: "Other", sort_order: 8 },
];
