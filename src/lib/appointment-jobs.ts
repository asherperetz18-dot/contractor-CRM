import type { Job } from "./data/types.ts";

/**
 * The jobs the appointment window uses (DECISIONS #147): a linked job's
 * name on the Calendar and Schedule, its address for the rep-info text,
 * and the "Related Job" picker.
 *
 * Both pages used to read every job the company ever had, every column,
 * on every visit. They now read only the jobs their appointments link to
 * (`linkedJobIds`); the picker's full list comes when someone who can
 * edit opens an appointment (`getJobOptions`). Pure, so the pages, the
 * window and the tests share it.
 */

const APPOINTMENT_JOB_FIELDS = ["id", "name", "address"] as const satisfies readonly (keyof Job)[];

export type AppointmentJob = Pick<Job, (typeof APPOINTMENT_JOB_FIELDS)[number]>;

export const APPOINTMENT_JOB_COLUMNS = APPOINTMENT_JOB_FIELDS.join(", ");

/** The jobs a set of appointments links to, each once. */
export function linkedJobIds(events: { job_id: string | null }[]): string[] {
  return [...new Set(events.map((e) => e.job_id).filter((id): id is string => !!id))];
}

/**
 * The picker's choices: every job once the list has arrived, and until
 * then just the job this appointment links to, so the field reads right
 * and saving without touching it keeps the link. A linked job the list
 * doesn't have stays first, rather than the field quietly reading "none"
 * while the appointment keeps it.
 */
export function jobPickerOptions(
  all: AppointmentJob[] | null,
  linked: AppointmentJob[],
  selectedId: string
): AppointmentJob[] {
  const selected = selectedId ? linked.find((j) => j.id === selectedId) : undefined;
  if (!all) return selected ? [selected] : [];
  if (!selected || all.some((j) => j.id === selected.id)) return all;
  return [selected, ...all];
}
