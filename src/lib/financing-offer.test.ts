import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { feeBpFromPercent, feePercentLabel, financingOffered, lenderFeeCents } from "./financing.ts";

/**
 * Offering financing per customer (DECISIONS #169): the lender keeps a fee
 * from every loan it funds, so the company decides customer by customer
 * whether to offer it, sees what it would cost first, and records the
 * fee as a job cost when a loan pays out.
 */

test("offered: the estimate's own switch wins; otherwise the company's default; on before either", () => {
  assert.equal(financingOffered(true, false), true);
  assert.equal(financingOffered(false, true), false);
  assert.equal(financingOffered(null, false), false);
  assert.equal(financingOffered(undefined, true), true);
  // Before 0219: as it always was.
  assert.equal(financingOffered(undefined, undefined), true);
});

test("the fee: a percent of the amount financed, to the cent", () => {
  assert.equal(lenderFeeCents(4_200_000, 990), 415_800);
  assert.equal(lenderFeeCents(3_780_000, 990), 374_220);
  assert.equal(lenderFeeCents(100, 990), 10); // 9.9 cents rounds to 10
  assert.equal(lenderFeeCents(4_200_000, null), null);
  assert.equal(lenderFeeCents(0, 990), 0);
});

test("the fee as typed in Settings: a percent from 0 to 50, kept in hundredths of a percent", () => {
  assert.deepEqual(feeBpFromPercent("9.9"), { bp: 990 });
  assert.deepEqual(feeBpFromPercent(" 12.25 "), { bp: 1225 });
  assert.deepEqual(feeBpFromPercent("0"), { bp: 0 });
  assert.deepEqual(feeBpFromPercent(""), { bp: null });
  assert.deepEqual(feeBpFromPercent("9.9%"), { bp: 990 });
  assert.deepEqual(feeBpFromPercent("abc"), { error: "Enter the fee as a percent, like 9.9." });
  assert.deepEqual(feeBpFromPercent("51"), { error: "Enter a fee from 0% to 50%." });
  assert.equal(feePercentLabel(990), "9.9%");
  assert.equal(feePercentLabel(1225), "12.25%");
  assert.equal(feePercentLabel(1000), "10%");
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("stored: the company's default and fee, and each estimate's switch", () => {
  const sql = source("../../supabase/migrations/0219_financing_offer.sql");
  assert.match(sql, /add column if not exists financing_offer_default boolean not null default true/);
  assert.match(sql, /add column if not exists financing_fee_bp integer\s+check \(financing_fee_bp is null or financing_fee_bp between 0 and 5000\)/);
  assert.match(sql, /alter table public\.estimates\s+add column if not exists financing_offered boolean;/);
  assert.match(sql, /as financing_offer_ready;/);
  assert.match(source("./schema-drift.ts"), /column: "financing_offered", migration: "0219_financing_offer\.sql"/);
});

test("off means off: no Apply card, no link to send, no link with a payment change", () => {
  const actions = source("./actions/financing.ts");
  assert.match(actions, /export async function setFinancingOffered\(/);
  assert.match(actions, /export async function saveFinancingOffer\(/);
  const send = actions.slice(actions.indexOf("export async function sendFinancingLink("));
  assert.match(send, /if \(!who\.offered\)/);
  assert.match(source("./actions/payment-change.ts"), /input\.withApplyLink && offered/);
  assert.match(source("../app/portal/estimates/[id]/page.tsx"), /financingOffered\(/);
  const panel = source("../app/(app)/estimates/[id]/financing-panel.tsx");
  assert.match(panel, /Offer financing to this customer/);
  assert.match(panel, /keeps about/);
});

test("the fee on a funded loan is a job cost on the job", () => {
  const actions = source("./actions/financing.ts");
  const record = actions.slice(actions.indexOf("export async function recordFinancingStatus("));
  assert.match(record, /\.from\("job_expenses"\)\s*\.insert\(/);
  assert.match(record, /category: "Financing fee"/);
  assert.match(record, /lead_id: doc\.lead_id/);
  // Never more than the payout, never for the customer's own loan.
  assert.match(record, /feeCents > amountCents/);
  assert.match(record, /who\.chosen\?\.own/);
  assert.match(source("../app/(app)/estimates/[id]/financing-panel.tsx"), /Lender kept a fee/);
  assert.match(source("../app/(app)/settings/customer-financing/financing-form.tsx"), /Offer financing on new estimates/);
});
