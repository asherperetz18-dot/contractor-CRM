import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expiringSoon, isExpired } from "./company-docs.ts";

/**
 * A certificate valid "through Dec 31" is valid all of Dec 31 on the
 * company's calendar. The settings page measured from the browser's UTC
 * date, already tomorrow from 5pm Pacific, so on a certificate's last
 * evening it said "expired, no longer shown to customers" while the
 * portal (on the company's day) still showed it.
 */

test("a certificate is valid through its whole expiry day", () => {
  assert.equal(isExpired("2026-10-08", "2026-10-08"), false);
  assert.equal(isExpired("2026-10-07", "2026-10-08"), true);
  assert.equal(isExpired(null, "2026-10-08"), false);
});

test("expiring soon is the next 30 days of the company's calendar, not counting lapsed ones", () => {
  assert.equal(expiringSoon("2026-10-08", "2026-10-08"), true);
  assert.equal(expiringSoon("2026-11-07", "2026-10-08"), true);
  assert.equal(expiringSoon("2026-11-08", "2026-10-08"), false);
  assert.equal(expiringSoon("2026-10-07", "2026-10-08"), false);
  assert.equal(expiringSoon(null, "2026-10-08"), false);
  // Across a year end, as plain day arithmetic.
  assert.equal(expiringSoon("2027-01-15", "2026-12-20"), true);
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the settings page and the portal judge expiry on the same company today", () => {
  const page = source("../../app/(app)/settings/certificates/page.tsx");
  const view = source("../../app/(app)/settings/certificates/certificates-view.tsx");
  const portal = source("../../app/portal/home/page.tsx");
  assert.match(page, /<CertificatesView today=\{await companyToday\(\)\} \/>/);
  assert.match(view, /isExpired\(d\.expires_on, today\)/);
  assert.match(view, /expiringSoon\(d\.expires_on, today\)/);
  assert.doesNotMatch(view, /isExpired\(d\.expires_on\)|expiringSoon\(d\.expires_on\)/);
  assert.match(portal, /!isExpired\(d\.expires_on, companyToday\)/);
});
