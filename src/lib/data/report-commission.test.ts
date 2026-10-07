import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reportNetCashLabel } from "./report-schedule.ts";
import { computeProjectRollup } from "./types.ts";
import { paidCommissionByEstimate } from "./commission-payouts.ts";

/**
 * The single-job report's Net cash left out commission paid, so once a
 * rep's payout was recorded against a job the report read higher than the
 * Projects list for the same job (#035, TECH_DEBT). The office copy now
 * takes the same figure the list does -- payouts and advances recorded
 * against the contract -- and says so in its label. The client copy never
 * shows pay, and doesn't even fetch it.
 */

const PAGE = readFileSync(new URL("../../app/(app)/projects/[id]/report/page.tsx", import.meta.url), "utf8");

test("net cash on the report is the Projects list's figure: collected less spent less commission paid", () => {
  const payouts = [
    { estimateId: "job-1", amountCents: 150000 },
    { estimateId: "job-1", amountCents: 50000 },
    { estimateId: "job-2", amountCents: 99900 },
  ];
  const commissionCents = paidCommissionByEstimate(payouts).get("job-1") ?? 0;
  const rollup = computeProjectRollup({
    contractTotalCents: 2000000,
    signedChangeOrderCents: 0,
    payments: [{ status: "succeeded", amount_cents: 2000000 }],
    receivableCents: 0,
    filedCostCents: 500000,
    unfiledCostCents: 0,
    ownsUnfiledCosts: true,
    commissionCents,
  });
  assert.equal(rollup.commissionCents, 200000);
  assert.equal(rollup.netCashCents, 2000000 - 500000 - 200000);
});

test("the label names commission only when some was paid", () => {
  assert.equal(reportNetCashLabel(0), "Net cash (collected − spent)");
  assert.equal(reportNetCashLabel(null), "Net cash (collected − spent)");
  assert.equal(reportNetCashLabel(200000), "Net cash (collected − spent − commission paid)");
});

test("the office copy reads commission paid on this contract and passes it to the rollup", () => {
  assert.match(PAGE, /\.from\("rep_commission_payouts"\)[\s\S]{0,200}\.eq\("estimate_id", contract\.id\)/);
  assert.match(PAGE, /computeProjectRollup\(\{[\s\S]*?commissionCents,?[\s\S]*?\}\)/);
  assert.match(PAGE, /reportNetCashLabel\(rollup\.commissionCents\)/);
});

test("the client copy never fetches or prints pay", () => {
  // The payout read sits behind the client-view check, so the client
  // copy can't leak it through a print dialog or the page source.
  assert.match(PAGE, /clientView\s*\?\s*Promise\.resolve\(\{ data: null \}\)\s*:\s*supabase\s*\.from\("rep_commission_payouts"\)/);
  assert.match(PAGE, /const commissionCents = clientView\s*\?\s*null\s*:/);
  // The client branch of the money summary ends before any commission row.
  const clientBranch = PAGE.slice(PAGE.indexOf("<span>Remaining on contract</span>"), PAGE.indexOf("Owed to you (billed, not yet paid)"));
  assert.ok(clientBranch.length > 0);
  assert.doesNotMatch(clientBranch, /ommission/);
});
