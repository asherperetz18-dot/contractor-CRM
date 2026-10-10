import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estimateExpired } from "./data/types.ts";

/**
 * A proposal is valid through its last day on the company's calendar
 * (DECISIONS #191). The customer portal judged it by the server's clock,
 * which runs on UTC -- already tomorrow from 5pm Pacific -- so on the
 * evening of the last day the customer saw "This estimate has expired"
 * instead of Sign, a signature was refused, and the optional lines locked.
 */

const lastDay = { status: "Sent" as const, expires_at: "2026-10-09" };

test("judged at the server's instant, a proposal expired at 5pm Pacific on its last day", () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    // 6pm Pacific on the 9th is 1am UTC on the 10th.
    assert.equal(estimateExpired(lastDay, new Date("2026-10-10T01:00:00Z")), true);
    // At noon of the company's today it is still valid all that day, and
    // expired from the next.
    assert.equal(estimateExpired(lastDay, new Date("2026-10-09T12:00:00")), false);
    assert.equal(estimateExpired(lastDay, new Date("2026-10-10T12:00:00")), true);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the portal page judges expiry on the company's today", () => {
  const page = source("../app/portal/estimates/[id]/page.tsx");
  // From the company row the page already reads: no extra round trip.
  assert.match(page, /const today = isoDateInZone\(new Date\(\), companyIanaZone\(company\?\.timezone\)\);/);
  assert.doesNotMatch(page, /todayForCompany/);
  assert.match(page, /const isExpired = estimateExpired\(estimate, new Date\(`\$\{today\}T12:00:00`\)\);/);
});

test("signing and choosing options judge it the same way", () => {
  const actions = source("./actions/portal-estimates.ts");
  assert.match(actions, /async function expired\(estimate: EstimateRow\): Promise<boolean> \{/);
  assert.match(actions, /const today = await todayForCompany\(createAdminClient\(\), estimate\.company_id\);/);
  assert.match(actions, /return estimateExpired\(estimate, new Date\(`\$\{today\}T12:00:00`\)\);/);
  assert.equal((actions.match(/if \(await expired\(estimate\)\) \{/g) ?? []).length, 2);
  assert.doesNotMatch(actions, /T23:59:59`\)\.getTime\(\) < Date\.now\(\)/);
});

test("a billed stage reads Due, not Was due, all of its due day", () => {
  const payments = source("./actions/portal-payments.ts");
  // Read alongside the stages, not before them.
  assert.match(payments, /const \[\{ data: phases \}, \{ data: allPayments \}, undecided, today\] = await Promise\.all\(\[/);
  assert.match(payments, /todayForCompany\(admin, estimate\.company_id\),\s*\]\);/);
  assert.match(payments, /state: phaseState\(p, on, new Date\(`\$\{today\}T12:00:00`\)\),/);
  assert.match(payments, /\.select\("id, lead_id, status, company_id"\)/);
});
