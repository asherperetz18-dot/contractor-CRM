import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APPOINTMENT_JOB_COLUMNS,
  jobPickerOptions,
  linkedJobIds,
  type AppointmentJob,
} from "./appointment-jobs.ts";

/**
 * The Calendar and the Schedule read every job the company ever had, every
 * column, on every visit (DECISIONS #147) -- for the job name on the few
 * appointments linked to one, and for the appointment window's "Related
 * Job" picker. They now read only the jobs their appointments link to;
 * the picker's full list comes when someone who can edit opens an
 * appointment.
 */

const job = (id: string, name: string): AppointmentJob => ({ id, name, address: `${name} St` });

test("jobs are read with only the columns the appointment window uses", () => {
  const read = APPOINTMENT_JOB_COLUMNS.split(",").map((c) => c.trim());
  assert.deepEqual(read, ["id", "name", "address"]);
});

test("only the jobs the loaded appointments link to, each once", () => {
  assert.deepEqual(
    linkedJobIds([{ job_id: "j1" }, { job_id: null }, { job_id: "j2" }, { job_id: "j1" }, { job_id: "" }]),
    ["j1", "j2"]
  );
  assert.deepEqual(linkedJobIds([]), []);
});

test("the picker shows the linked job until the full list arrives, then every job", () => {
  const linked = [job("j2", "Bravo"), job("j9", "Other appointment's job")];
  // Before the list arrives: just the job this appointment links to, so
  // the field reads right and saving without touching it keeps it.
  assert.deepEqual(jobPickerOptions(null, linked, "j2"), [job("j2", "Bravo")]);
  assert.deepEqual(jobPickerOptions(null, linked, ""), []);
  // After: every job, as the page used to carry them.
  const all = [job("j1", "Alpha"), job("j2", "Bravo"), job("j3", "Charlie")];
  assert.deepEqual(jobPickerOptions(all, linked, "j2"), all);
  // A linked job the list doesn't have still shows, rather than the field
  // quietly reading "none" while the appointment keeps the link.
  assert.deepEqual(jobPickerOptions(all.slice(0, 1), linked, "j2"), [job("j2", "Bravo"), job("j1", "Alpha")]);
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("neither page reads the jobs table itself; the shared loader reads the linked jobs by id", () => {
  for (const page of ["../app/(app)/calendar/page.tsx", "../app/(app)/schedule/page.tsx"]) {
    const src = source(page);
    assert.doesNotMatch(src, /from\("jobs"\)/, page);
    assert.match(src, /const \{ leads, leadTasks, leadNotes, estimates, jobs \} = await loadAppointmentContext\(/, page);
  }
  const context = source("./data/appointment-context.ts");
  assert.match(context, /linkedJobIds\(events\)/);
  assert.match(context, /\.from\("jobs"\)\s*\.select\(APPOINTMENT_JOB_COLUMNS\)\s*\.eq\("company_id", companyId\)\s*\.in\("id", chunk\)/);
});

test("the full list loads only for someone who can edit, when they open an appointment", () => {
  const action = source("./actions/jobs.ts");
  assert.match(action, /export async function getJobOptions\(\)/);
  assert.match(action, /\.from\("jobs"\)\s*\.select\(APPOINTMENT_JOB_COLUMNS\)\s*\.eq\("company_id", profile\.company_id\)\s*\.order\("name", \{ ascending: true \}\)/);
  const form = source("../app/(app)/calendar/event-form.tsx");
  assert.match(form, /if \(readOnly\) return;\s*let live = true;\s*getJobOptions\(\)/);
  assert.match(form, /jobPickerOptions\(jobOptions, jobs, form\.job_id\)/);
  assert.match(form, /jobs: AppointmentJob\[\];/);
});
