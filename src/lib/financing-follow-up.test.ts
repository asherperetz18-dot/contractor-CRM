import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FOLLOW_UP_DAYS, followUpDue, followUpTitle, remindsFor } from "./financing.ts";

/**
 * Financing follow-ups (DECISIONS #164): sending the lender's link or
 * marking a customer Applied puts a follow-up task on the person's list,
 * due a few days out; the next step on that estimate closes it.
 */

test("a reminder goes with a sent link or an application, nothing else", () => {
  assert.equal(remindsFor("sent"), true);
  assert.equal(remindsFor("applied"), true);
  for (const s of ["approved", "declined", "funded"] as const) assert.equal(remindsFor(s), false, s);
});

test("due a few days out, on the company's calendar, from the choices offered", () => {
  assert.deepEqual([...FOLLOW_UP_DAYS], [1, 2, 3, 5, 7]);
  assert.equal(followUpDue("2026-10-07", 3), "2026-10-10");
  assert.equal(followUpDue("2026-10-30", 3), "2026-11-02");
  assert.equal(followUpDue("2026-12-30", 5), "2027-01-04");
  // Anything else falls back to 3 days.
  assert.equal(followUpDue("2026-10-07", 4), "2026-10-10");
  assert.equal(followUpDue("2026-10-07", Number.NaN), "2026-10-10");
});

test("the task says what to follow up on: the document, and the lender", () => {
  assert.equal(
    followUpTitle("sent", "EST-1047", "Service Finance"),
    "Financing on EST-1047: did they apply with Service Finance?"
  );
  assert.equal(
    followUpTitle("applied", "EST-1047", "Service Finance"),
    "Financing on EST-1047: has Service Finance decided?"
  );
  assert.equal(followUpTitle("applied", "EST-1047", null), "Financing on EST-1047: has the lender decided?");
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the task is linked to its step, made by the server, and closed by the next step", () => {
  const sql = source("../../supabase/migrations/0216_financing_follow_ups.sql");
  assert.match(
    sql,
    /add column if not exists follow_up_task_id uuid references public\.lead_tasks \(id\) on delete set null/
  );
  assert.match(sql, /as financing_follow_ups_ready;/);

  const actions = source("./actions/financing.ts");
  const fn = (name: string) => {
    const from = actions.indexOf(name);
    assert.ok(from >= 0, name);
    const next = actions.indexOf("\nasync function ", from + 1);
    const nextExport = actions.indexOf("\nexport async function ", from + 1);
    const end = [next, nextExport].filter((i) => i > 0);
    return actions.slice(from, end.length ? Math.min(...end) : undefined);
  };
  // Every way a link goes out or an application is recorded can remind,
  // and each checks for 0216 before anything is sent or paid. Sending a
  // link -- by itself, or to the next lender after a no (#170) -- checks,
  // then hands over to the one function that sends it and saves the step.
  const record = fn("export async function recordFinancingStatus(");
  assert.match(record, /remindInDays/);
  assert.match(record, /await followUpsReady\(admin\)\)\) return \{ error: NEEDS_0216 \}/);
  assert.match(record, /await saveStep\(/);
  assert.ok(record.indexOf("followUpsReady") < record.indexOf("await saveStep("));
  assert.ok(record.indexOf("followUpsReady") < record.indexOf('.from("portal_payments")'));
  for (const name of ["export async function sendFinancingLink(", "export async function tryNextLender("]) {
    const body = fn(name);
    assert.match(body, /remindInDays/, name);
    assert.match(body, /await followUpsReady\(admin\)\)\) return \{ error: NEEDS_0216 \}/, name);
    assert.ok(body.indexOf("followUpsReady") < body.indexOf("deliverFinancingLink("), name);
  }
  const deliver = fn("async function deliverFinancingLink(");
  assert.match(deliver, /await saveStep\(/);
  assert.ok(deliver.indexOf("sendEmail(") < deliver.indexOf("await saveStep("));

  const start = fn("async function startFollowUp(");
  assert.match(start, /\.from\("lead_tasks"\)\s*\.insert\(/);
  assert.match(start, /assigned_to: profileId/);
  assert.match(start, /due_date: due/);
  assert.match(start, /followUpDue\(await companyToday\(\), days\)/);

  const save = fn("async function saveStep(");
  assert.match(save, /remindsFor\(step\.status\)/);
  // The task id is sent only with a task, so saving works without 0216.
  assert.match(save, /\.\.\.\(followUp \? \{ follow_up_task_id: followUp\.id \} : \{\}\)/);
  // A step that can't be saved leaves no stray task behind.
  assert.match(save, /if \(followUp\) await admin\.from\("lead_tasks"\)\.delete\(\)\.eq\("id", followUp\.id\)/);
  assert.match(save, /await closeFollowUps\(admin, doc, followUp\?\.id \?\? null\)/);

  const close = fn("async function closeFollowUps(");
  assert.match(close, /\.filter\(\(id\) => id !== keep\)/);
  assert.match(close, /\.is\("completed_at", null\)/);
  assert.match(close, /completed_at: new Date\(\)\.toISOString\(\)/);

  // Restored from Trash after the contact's tasks, which it points at.
  const trash = source("./lead-trash.ts");
  assert.match(trash, /table !== "bill_credits" && table !== "estimate_financing_events"/);
  assert.match(trash, /await put\("estimate_financing_events", payload\.children\.estimate_financing_events\);/);

  assert.match(source("./schema-drift.ts"), /column: "follow_up_task_id", migration: "0216_financing_follow_ups\.sql"/);
  assert.match(source("../app/(app)/estimates/[id]/financing-panel.tsx"), /remind me to follow up in/i);
});
