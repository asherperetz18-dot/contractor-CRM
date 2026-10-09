import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * A commission is payroll for the month its last gate cleared (the final
 * payment, or the completion certificate). Both statements read that
 * month, and every date they print, on the company's clock: a job paid
 * off after 5pm Pacific on the 30th used to be next month's payroll,
 * because the server's day had already turned. periodBalance's tests pin
 * the balance; these pin that the pages hand it the company's calendar.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const dispatcher = source("../app/(app)/commissions/statement/page.tsx");
const sales = source("../app/(app)/sales-commission/statement/page.tsx");
const job = source("../app/(app)/sales-commission/statement/job-statement.tsx");

test("both statements open on the company's month and list what came due on its days", () => {
  for (const page of [dispatcher, sales]) {
    assert.match(page, /const now = await companyNow\(\);/);
    assert.match(page, /const zone = await getCompanyZone\(\);/);
    // A date in the address that isn't a real day falls back to the
    // month, rather than crashing the cut at the company's midnight.
    assert.match(page, /const from = calendarDay\(sp\.from\) \?\? /);
    assert.match(page, /const to = calendarDay\(sp\.to\) \?\? /);
    assert.match(page, /const inPeriod = stampedWithin\(\{ from, to \}, zone\);/);
    assert.doesNotMatch(page, /qualifiedAt\.slice\(0, 10\)/);
  }
});

test("the sales statement's balances are worked out on the company's days", () => {
  assert.match(sales, /periodBalance\(lines, payoutLikes, from, to, zone\)/);
  assert.match(sales, /periodBalancesByRep\(lines, payoutLikes, from, to, zone\)/);
  assert.match(sales, /zone=\{zone\}/);
});

test("every date a statement prints is the company's day, not the server's", () => {
  // A payment or signature at 7pm Pacific printed as the next day.
  for (const page of [dispatcher, sales, job]) {
    assert.doesNotMatch(page, /function longDate/);
    assert.match(page, /dayLabel\(/);
  }
});
