import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { bearerToken, sameSecret } from "./cron-token.ts";

test("a job request's token is read from a plain Bearer header only", () => {
  assert.equal(bearerToken("Bearer abc123"), "abc123");
  assert.equal(bearerToken("  Bearer abc123  "), "abc123");
  assert.equal(bearerToken("bearer abc123"), null);
  assert.equal(bearerToken("Basic abc123"), null);
  assert.equal(bearerToken("Bearer "), null);
  assert.equal(bearerToken("Bearer a b"), null);
  assert.equal(bearerToken(null), null);
});

test("secrets match only when identical, and an empty one never matches", () => {
  assert.equal(sameSecret("s3cret", "s3cret"), true);
  assert.equal(sameSecret("s3cret", "s3creT"), false);
  assert.equal(sameSecret("s3cret", "s3cret-longer"), false);
  assert.equal(sameSecret("", ""), false);
});

const repo = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repo), "utf8");
const migration = read("supabase/migrations/0203_scheduled_jobs.sql");
/** Jobs added since 0203 are scheduled by their own migration. */
const schedules = migration + read("supabase/migrations/0208_bill_reminders.sql");

/** The jobs the database's scheduler now starts, and when (UTC) -- the times GitHub used. */
const SCHEDULED: Record<string, string> = {
  "appointment-reminders": "*/15 * * * *",
  "task-reminders": "*/15 * * * *",
  "no-show-followups": "*/15 * * * *",
  "primecall-sync": "*/15 * * * *",
  "google-calendar-sync": "7,22,37,52 * * * *",
  "time-clock": "7 * * * *",
  "ai-receptionist-finalize": "13 */2 * * *",
  "callrail-backfill": "40 */6 * * *",
  "rain-alerts": "0 6,14,22 * * *",
  // Payment reminders (0208, DECISIONS #152).
  "bill-reminders": "25 * * * *",
};

test("every job route is started by exactly one scheduler", () => {
  const routes = readdirSync(new URL("src/app/api/cron/", repo)).sort();
  // Every route but the backup runs from the database; the backup stays on GitHub.
  assert.deepEqual(routes.filter((r) => r !== "backup"), Object.keys(SCHEDULED).sort());
  for (const [job, cron] of Object.entries(SCHEDULED)) {
    const line = schedules.split("\n").find((l) => l.includes(`'crm-${job}'`)) ?? "";
    assert.ok(line.includes(`'${cron}'`) && line.includes(`crm_jobs.run('/api/cron/${job}`), `${job} is scheduled at ${cron}`);
    // ...and GitHub no longer starts it on a timer, so it can't run twice at once.
    const workflow = read(`.github/workflows/${job}.yml`);
    assert.doesNotMatch(workflow, /^\s*schedule:/m, `${job}: GitHub timer removed`);
    assert.match(workflow, /workflow_dispatch/, `${job}: the by-hand button stays`);
  }
  assert.match(read(".github/workflows/nightly-backup.yml"), /^\s*schedule:/m);
  assert.doesNotMatch(migration, /\/api\/cron\/backup/);
});

test("the job routes accept the database's token or CRON_SECRET; the backup only CRON_SECRET", () => {
  for (const job of Object.keys(SCHEDULED)) {
    const route = read(`src/app/api/cron/${job}/route.ts`);
    assert.match(route, /const refused = await refuseCronCaller\(req\);\s*if \(refused\) return refused;/, job);
    assert.doesNotMatch(route, /getCronSecret/, job);
  }
  // The backup returns every company's data: the database's scheduler can't ask for it.
  const backup = read("src/app/api/cron/backup/route.ts");
  assert.match(backup, /getCronSecret\(\)/);
  assert.doesNotMatch(backup, /refuseCronCaller/);
});

test("nobody signed in to the app can start a job or test a token", () => {
  assert.match(migration, /revoke all on function public\.crm_job_token_ok\(text\) from public, anon, authenticated;/);
  assert.match(migration, /grant execute on function public\.crm_job_token_ok\(text\) to service_role;/);
  assert.match(migration, /revoke all on schema crm_jobs from public, anon, authenticated;/);
  assert.match(migration, /revoke all on function crm_jobs\.run\(text\) from public, anon, authenticated;/);
  // Only CRM job routes, only on the CRM's own address.
  assert.match(migration, /if path !~ '\^\/api\/cron\//);
  assert.match(migration, /url := 'https:\/\/crm\.aibuildpros\.com' \|\| path/);
  // The token is made in the database, never written in a file.
  assert.match(migration, /vault\.create_secret\(\s*replace\(gen_random_uuid\(\)/);
});
