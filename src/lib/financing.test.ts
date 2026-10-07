import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { financingSettingsError, readFinancing, showFinancingOffer } from "./financing.ts";

/**
 * Customer financing, step 1 (DECISIONS #161): each company adds the
 * application link its own lender gave it, and its customers see "Apply
 * for financing" on their estimates and contracts. The CRM claims nothing
 * about rates or payments -- those are the lender's to state.
 */

test("the link the office types must be a real https address, with the lender's name", () => {
  // Nothing at all switches it off.
  assert.equal(financingSettingsError({ provider: "", url: "" }), null);
  assert.equal(financingSettingsError({ provider: "Wisetack", url: "https://wisetack.us/#/abc123/prequalify" }), null);
  assert.match(financingSettingsError({ provider: "", url: "https://example.com/apply" })!, /lender/i);
  assert.match(financingSettingsError({ provider: "Hearth", url: "" })!, /link/i);
  assert.match(financingSettingsError({ provider: "Hearth", url: "http://example.com/apply" })!, /https/);
  assert.match(financingSettingsError({ provider: "Hearth", url: "example.com/apply" })!, /https/);
  assert.match(financingSettingsError({ provider: "Hearth", url: "javascript:alert(1)" })!, /https/);
  assert.match(financingSettingsError({ provider: "Hearth", url: "https://localhost/apply" })!, /link/i);
  // A sign-in name in the address is never a lender's public link.
  assert.match(financingSettingsError({ provider: "Hearth", url: "https://user:pass@example.com/apply" })!, /link/i);
  assert.match(financingSettingsError({ provider: "Hearth", url: `https://example.com/${"a".repeat(500)}` })!, /long/i);
  assert.match(financingSettingsError({ provider: "x".repeat(61), url: "https://example.com/apply" })!, /long/i);
});

test("what the company saved is read back only when it's complete and safe to link to", () => {
  assert.deepEqual(readFinancing({ financing_provider: " Hearth ", financing_url: " https://app.gethearth.com/financing/1/2 " }), {
    provider: "Hearth",
    url: "https://app.gethearth.com/financing/1/2",
  });
  assert.equal(readFinancing(null), null);
  assert.equal(readFinancing({ financing_provider: "Hearth", financing_url: null }), null);
  assert.equal(readFinancing({ financing_provider: null, financing_url: "https://example.com/apply" }), null);
  assert.equal(readFinancing({ financing_provider: "Hearth", financing_url: "http://example.com/apply" }), null);
  // Before 0214 the columns aren't there at all.
  assert.equal(readFinancing({}), null);
});

test("the offer shows on an estimate or contract still to be paid for, never on a closed one", () => {
  const open = { kind: "contract" as const, status: "Sent", expired: false, settled: false };
  assert.equal(showFinancingOffer(open), true);
  assert.equal(showFinancingOffer({ ...open, status: "Viewed" }), true);
  assert.equal(showFinancingOffer({ ...open, kind: "change_order" }), true);
  // Signed, with money still to pay.
  assert.equal(showFinancingOffer({ ...open, status: "Signed" }), true);
  // Signed and paid for: nothing to finance.
  assert.equal(showFinancingOffer({ ...open, status: "Signed", settled: true }), false);
  assert.equal(showFinancingOffer({ ...open, status: "Declined" }), false);
  assert.equal(showFinancingOffer({ ...open, status: "Void" }), false);
  assert.equal(showFinancingOffer({ ...open, expired: true }), false);
  // An invoice (a permit fee billed back) or a completion certificate isn't a job to finance.
  assert.equal(showFinancingOffer({ ...open, kind: "invoice" }), false);
  assert.equal(showFinancingOffer({ ...open, kind: "completion" }), false);
});

test("a lender's application page is refused: it only opens for a browser that came through the dealer's link", () => {
  // Service Finance: /embedded is the form itself. A customer arriving
  // from the CRM gets "Access Denied"; the link to give them is the one
  // that opens it.
  for (const url of [
    "https://apply.svcfin.com/embedded",
    "https://APPLY.svcfin.com/Embedded/",
    "https://apply.svcfin.com/Home/denied",
  ]) {
    assert.match(financingSettingsError({ provider: "Service Finance", url })!, /dealerAuthentication/, url);
    // Already saved before this check: customers aren't sent there.
    assert.equal(readFinancing({ financing_provider: "Service Finance", financing_url: url }), null, url);
  }
  const real = "https://apply.svcfin.com/home/dealerAuthentication?id=400000000&key=1234567890";
  assert.equal(financingSettingsError({ provider: "Service Finance", url: real }), null);
  assert.deepEqual(readFinancing({ financing_provider: "Service Finance", financing_url: real }), { provider: "Service Finance", url: real });
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the settings page says to try the link as a customer would, and flags a saved link customers can't use", () => {
  const form = source("../app/(app)/settings/customer-financing/financing-form.tsx");
  assert.match(form, /private/i);
  assert.match(form, /initial\.problem/);
  const actions = source("./actions/financing.ts");
  assert.match(actions, /problem: url \? financingSettingsError\(\{ provider, url \}\) : null/);
});

test("the company's link: stored checked, set by Office or Admin, read without breaking before 0214", () => {
  const sql = source("../../supabase/migrations/0214_customer_financing.sql");
  assert.match(sql, /add column if not exists financing_provider text/);
  assert.match(sql, /add column if not exists financing_url text/);
  // The database refuses anything but an https link, whatever writes it.
  assert.match(sql, /financing_url is null or \(financing_url ~ '\^https:\/\/'/);
  assert.match(sql, /as customer_financing_ready;/);

  const actions = source("./actions/financing.ts");
  assert.match(actions, /export async function saveFinancingSettings\(/);
  assert.match(actions, /isAdminRole\(profile\)/);
  assert.match(actions, /financingSettingsError\(/);

  // The portal reads the lender on its own (every column since 0219, for
  // the offer default), so a database without 0214 shows no offer
  // instead of failing the page.
  const portal = source("../app/portal/estimates/[id]/page.tsx");
  assert.match(portal, /\.from\("company_profile"\)\s*\.select\("(financing_provider, financing_url|\*)"\)/);
  assert.match(portal, /showFinancingOffer\(/);
  assert.match(portal, /<FinancingOffer/);
});

test("the customer's card: the lender's own page, in a new tab, and no rate or payment claims", () => {
  const card = source("../app/portal/estimates/[id]/financing-offer.tsx");
  assert.match(card, /target="_blank"/);
  assert.match(card, /rel="noopener noreferrer"/);
  assert.match(card, /Apply for financing/);
  // Rates and monthly payments are the lender's to state, with their terms.
  assert.doesNotMatch(card, /APR|%|\/mo|per month|a month|as low as|credit score/i);
});
