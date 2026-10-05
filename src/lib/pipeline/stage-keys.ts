/**
 * Stage tags (DECISIONS #120).
 *
 * Every company names its own pipeline stages. The standard ones also
 * carry a fixed tag (pipeline_stages.key), and every lead carries the tag
 * of the stage it is in (leads.stage_key, kept by the database). The app
 * goes by the tag -- "move to won", "count what isn't closed" -- so a
 * company can rename any stage ("Won" to "Sold", "Appointment Scheduled"
 * to "Inspection Booked") without switching anything off.
 *
 * Pure: no database, no Next.js -- the board, the server and the tests
 * all read it.
 */

export const STAGE_KEYS = [
  "unsorted",
  "new_lead",
  "no_answer",
  "contacted",
  "appointment_scheduled",
  "appointment_follow_up",
  "second_appointment",
  "estimate_prepared",
  "proposal_sent",
  "pending_finance",
  "close_to_sale",
  "won",
  "lost",
  "not_interested",
  "dnc",
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

/** The name each tagged stage starts with in a new company. */
export const STANDARD_STAGE_NAMES: Record<StageKey, string> = {
  unsorted: "Unsorted",
  new_lead: "New Lead",
  no_answer: "No Answer",
  contacted: "Contacted",
  appointment_scheduled: "Appointment Scheduled",
  appointment_follow_up: "Appointment Follow Up",
  second_appointment: "2nd Appointment",
  estimate_prepared: "Estimate Prepared",
  proposal_sent: "Proposal Sent",
  pending_finance: "Pending Finance",
  close_to_sale: "Close to Sale",
  won: "Won",
  lost: "Lost",
  not_interested: "Not Interested",
  dnc: "DNC",
};

/**
 * The stages the app always needs somewhere to put a lead: new leads,
 * booked appointments, and the two endings. They can be renamed but not
 * deleted (is_system).
 */
export const REQUIRED_STAGE_KEYS: readonly StageKey[] = ["unsorted", "appointment_scheduled", "won", "lost"];

/**
 * Closed: out of the working pipeline. Not counted as open, not chased
 * as a follow-up, never "stale". The database's copy is is_closed_stage()
 * (migration 0195); a test keeps the two the same.
 */
export const CLOSED_STAGE_KEYS: readonly StageKey[] = ["won", "lost", "not_interested", "dnc"];

export function isClosedStageKey(key: string | null | undefined): boolean {
  return !!key && (CLOSED_STAGE_KEYS as readonly string[]).includes(key);
}

/**
 * The same test as a PostgREST filter, for `.or(OPEN_LEADS_FILTER)` on a
 * leads query. A company's own stages have no tag, and are open.
 */
export const OPEN_LEADS_FILTER = `stage_key.is.null,stage_key.not.in.(${CLOSED_STAGE_KEYS.join(",")})`;

/**
 * The two endings. The pipeline board and the dialer show each as its own
 * view (Won, Lost); their Open view is every other column.
 */
export const ENDING_STAGE_KEYS: readonly StageKey[] = ["won", "lost"];

export function isEndingStageKey(key: string | null | undefined): boolean {
  return !!key && (ENDING_STAGE_KEYS as readonly string[]).includes(key);
}

/** The tagged intake stages: still waiting for a first appointment. */
export const PRE_APPOINTMENT_STAGE_KEYS: readonly StageKey[] = ["unsorted", "new_lead", "no_answer", "contacted"];

/**
 * Already at or past "proposal sent". Sending a revised estimate to
 * someone in Pending Finance must not drag them backwards -- sort order
 * can't decide this, because Lost and DNC are endings parked at the end
 * of the board rather than late stages.
 */
export const AT_OR_PAST_PROPOSAL_KEYS: readonly StageKey[] = ["proposal_sent", "pending_finance", "close_to_sale", "won"];

export function isStageKey(value: unknown): value is StageKey {
  return typeof value === "string" && (STAGE_KEYS as readonly string[]).includes(value);
}

export type TaggedStage = { name: string; key?: string | null; sort_order?: number };

/** The tag of the stage called `name` in this pipeline, or null for a company's own stage. */
export function stageKeyOf(stages: readonly TaggedStage[], name: string | null | undefined): StageKey | null {
  const key = stages.find((s) => s.name === name)?.key;
  return isStageKey(key) ? key : null;
}

/** What this company calls the stage with this tag, or null if it has none. */
export function stageNameFor(stages: readonly TaggedStage[], key: StageKey): string | null {
  return stages.find((s) => s.key === key)?.name ?? null;
}

/** The stage's own name, or the standard one when the company has no such stage. */
export function stageLabel(stages: readonly TaggedStage[], key: StageKey): string {
  return stageNameFor(stages, key) ?? STANDARD_STAGE_NAMES[key];
}

/**
 * Stages where a lead is still waiting for its first appointment: the
 * tagged intake stages, plus a company's own stages placed before its
 * Appointment Scheduled stage on the board (a "Facebook Leads" column,
 * say). The database's copy is pre_appointment_stage_names() (0195).
 */
export function preAppointmentStageNames(stages: readonly TaggedStage[]): string[] {
  const booked = stages.find((s) => s.key === "appointment_scheduled");
  return stages
    .filter((s) =>
      isStageKey(s.key)
        ? PRE_APPOINTMENT_STAGE_KEYS.includes(s.key)
        : !s.key && booked?.sort_order != null && s.sort_order != null && s.sort_order < booked.sort_order
    )
    .map((s) => s.name);
}

export function isPreAppointmentStage(stages: readonly TaggedStage[], name: string | null | undefined): boolean {
  return !!name && preAppointmentStageNames(stages).includes(name);
}

/** The names of this company's closed stages (for filters that work on names). */
export function closedStageNames(stages: readonly TaggedStage[]): string[] {
  return stages.filter((s) => isClosedStageKey(s.key)).map((s) => s.name);
}
