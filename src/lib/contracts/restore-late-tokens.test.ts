import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreLateTokens } from "./restore-late-tokens.ts";

/**
 * These terms go onto a document a customer signs, so the edges are
 * tested: the round trip back to tokens, the deposit/total collision, and
 * the wording that must never be touched.
 */

const values = {
  contract_total: "$114,000.00",
  deposit_amount: "$1,000.00",
  start_date: "September 8, 2026",
  completion_date: "February 26, 2027",
};

test("filled money and dates become their tokens again", () => {
  const body =
    "The total price is $114,000.00, with $1,000.00 due at signing. " +
    "Work begins about September 8, 2026 and completes about February 26, 2027.";
  assert.equal(
    restoreLateTokens(body, values),
    "The total price is {{contract_total}}, with {{deposit_amount}} due at signing. " +
      "Work begins about {{start_date}} and completes about {{completion_date}}."
  );
});

test("every occurrence is restored, not just the first", () => {
  const body = "Pay $1,000.00 now. The $1,000.00 deposit is credited to the final bill.";
  assert.equal(
    restoreLateTokens(body, values),
    "Pay {{deposit_amount}} now. The {{deposit_amount}} deposit is credited to the final bill."
  );
});

test("a deposit equal to the total reads as the deposit, not two totals", () => {
  const equal = { contract_total: "$500.00", deposit_amount: "$500.00" };
  // Ambiguous by construction; what matters is that both spots become a
  // token that the next send fills with the same $500.00 again -- not
  // that one figure survives as stale text.
  const out = restoreLateTokens("Total $500.00, deposit $500.00.", equal);
  assert.equal(out.includes("$500.00"), false);
  assert.equal(out, "Total {{deposit_amount}}, deposit {{deposit_amount}}.");
});

test("missing values leave the body alone", () => {
  const body = "Start date to be agreed. Total $9,999.00.";
  assert.equal(
    restoreLateTokens(body, { contract_total: "$114,000.00", start_date: null }),
    body
  );
});

test("wording that merely resembles money is not rewritten", () => {
  const body = "A late fee of $50.00 per week applies after February 26, 2027.";
  const out = restoreLateTokens(body, values);
  // The completion date genuinely appears and comes back as its token;
  // the unrelated $50.00 stays exactly as written.
  assert.equal(out, "A late fee of $50.00 per week applies after {{completion_date}}.");
});
