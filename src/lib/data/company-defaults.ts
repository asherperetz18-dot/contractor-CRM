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
 * The names and colours are the ones every company on the system already
 * shares; the per-business extras ("Meta", "Roy Leads", ...) are
 * deliberately left out. Everything is editable in Settings afterwards,
 * except the is_system rows, which the app relies on by name.
 */

export type DefaultNamedRow = { name: string; color: string; sort_order: number; is_system: boolean };
export type DefaultSimpleRow = { name: string; sort_order: number };

// is_system marks the four stages the app itself moves leads into --
// Unsorted for anything unrecognised, Appointment Scheduled when an
// appointment is booked, Won/Lost at the end. Renaming or deleting one
// would break that, which is why they are flagged rather than ordinary.
export const DEFAULT_PIPELINE_STAGES: DefaultNamedRow[] = [
  { name: "Unsorted", color: "#9A9384", sort_order: 1, is_system: true },
  { name: "New Lead", color: "#7C8798", sort_order: 2, is_system: false },
  { name: "No Answer", color: "#B7862B", sort_order: 3, is_system: false },
  { name: "Contacted", color: "#2D5F8A", sort_order: 4, is_system: false },
  { name: "Appointment Scheduled", color: "#C7691B", sort_order: 5, is_system: true },
  { name: "Appointment Follow Up", color: "#C7691B", sort_order: 6, is_system: false },
  { name: "2nd Appointment", color: "#C7691B", sort_order: 7, is_system: false },
  { name: "Estimate Prepared", color: "#2D5F8A", sort_order: 8, is_system: false },
  { name: "Proposal Sent", color: "#2D5F8A", sort_order: 9, is_system: false },
  { name: "Pending Finance", color: "#B7862B", sort_order: 10, is_system: false },
  { name: "Close to Sale", color: "#B7862B", sort_order: 11, is_system: false },
  { name: "Won", color: "#2F855A", sort_order: 12, is_system: true },
  { name: "Lost", color: "#C0392B", sort_order: 13, is_system: true },
  { name: "Not Interested", color: "#C0392B", sort_order: 14, is_system: false },
  { name: "DNC", color: "#9A9384", sort_order: 15, is_system: false },
];

export const DEFAULT_CALENDARS: DefaultNamedRow[] = [
  { name: "Estimate", color: "#2D5F8A", sort_order: 1, is_system: false },
  { name: "Job Visit", color: "#2F855A", sort_order: 2, is_system: false },
  { name: "Meeting", color: "#C7691B", sort_order: 3, is_system: false },
  { name: "Other", color: "#7C8798", sort_order: 4, is_system: false },
];

// "No Disposition" is what a call log carries before anyone picks an
// outcome, so it has to exist from the first call onwards.
export const DEFAULT_CALL_DISPOSITIONS: DefaultNamedRow[] = [
  { name: "No Disposition", color: "#9A9384", sort_order: 1, is_system: true },
  { name: "Connected", color: "#2D5F8A", sort_order: 2, is_system: false },
  { name: "Sale / Won", color: "#2F855A", sort_order: 3, is_system: false },
  { name: "Callback", color: "#C7691B", sort_order: 4, is_system: false },
  { name: "Appointment Set", color: "#6B4FA0", sort_order: 5, is_system: false },
  { name: "Left Voicemail", color: "#4A90A4", sort_order: 6, is_system: false },
  { name: "No Answer", color: "#B7862B", sort_order: 7, is_system: false },
  { name: "Not Interested", color: "#C0392B", sort_order: 8, is_system: false },
  { name: "Wrong Number", color: "#7C8798", sort_order: 9, is_system: false },
  { name: "Other", color: "#9A9384", sort_order: 10, is_system: false },
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
