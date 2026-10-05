import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accessRecordOutcome, defaultCompanyId, filterAccessLog, type AccessLogRow } from "./platform-access.ts";

test("with no company chosen yet, a platform admin lands in a company of their own, not one they only look into", () => {
  assert.equal(
    defaultCompanyId([
      { company_id: "other", look_in: true },
      { company_id: "mine", look_in: false },
    ]),
    "mine"
  );
  // Only look-in seats: the first one, as before -- they still need somewhere to land.
  assert.equal(defaultCompanyId([{ company_id: "only", look_in: true }]), "only");
  assert.equal(defaultCompanyId([]), null);
});

test("a company opens only once its visit is on the record", () => {
  assert.equal(accessRecordOutcome(null), "recorded");
  // Until the migration is run there is nowhere to write; opening still works.
  assert.equal(accessRecordOutcome({ code: "42P01", message: 'relation "platform_access_log" does not exist' }), "not_ready");
  assert.equal(accessRecordOutcome({ code: "PGRST205", message: "Could not find the table" }), "not_ready");
  // Any other failure keeps the company closed: no unrecorded visits.
  assert.equal(accessRecordOutcome({ code: "08006", message: "connection failure" }), "failed");
  assert.equal(accessRecordOutcome({ message: "permission denied" }), "failed");
});

const rows: AccessLogRow[] = [
  { id: "1", company_name: "Summit Builders Co", actor_name: "Pat Admin", actor_email: "pat@example.com", opened_at: "2026-10-05T10:00:00Z" },
  { id: "2", company_name: "Apex HVAC", actor_name: null, actor_email: "ops@example.com", opened_at: "2026-10-04T10:00:00Z" },
];

test("the record can be searched by company or by who opened it", () => {
  assert.deepEqual(filterAccessLog(rows, "").map((r) => r.id), ["1", "2"]);
  assert.deepEqual(filterAccessLog(rows, " summit ").map((r) => r.id), ["1"]);
  assert.deepEqual(filterAccessLog(rows, "PAT").map((r) => r.id), ["1"]);
  assert.deepEqual(filterAccessLog(rows, "ops@").map((r) => r.id), ["2"]);
  assert.deepEqual(filterAccessLog(rows, "nobody"), []);
});

test("switching company writes the record before the cookie, and only for a look-in seat", () => {
  const source = readFileSync(new URL("./actions/company.ts", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("export async function switchCompany"), source.indexOf("export async function createCompany"));
  assert.match(fn, /granted_via_platform_admin/);
  assert.match(fn, /recordPlatformAccess\(/);
  assert.ok(
    fn.indexOf("recordPlatformAccess(") < fn.indexOf("setCurrentCompanyCookie("),
    "the visit is recorded before the company is opened"
  );
});
