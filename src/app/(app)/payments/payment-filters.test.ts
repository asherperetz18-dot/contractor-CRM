import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesClientRep, paymentsSummary } from "./payment-filters.ts";

/**
 * The Payments page filters by client and rep the same way Money to
 * Collect does, and one predicate scopes all three tables. The edges
 * worth pinning: rows with no lead or no rep (old imports, contracts
 * whose lead was deleted) must vanish under a filter rather than leak
 * into every client's view.
 */

const row = { leadId: "lead-1", rep: "Brendan" };

test("no filter set matches every row", () => {
  assert.equal(matchesClientRep({ clientId: "", rep: "" }, row), true);
  assert.equal(matchesClientRep({ clientId: "", rep: "" }, { leadId: null, rep: null }), true);
});

test("client filter matches only that lead's rows", () => {
  assert.equal(matchesClientRep({ clientId: "lead-1", rep: "" }, row), true);
  assert.equal(matchesClientRep({ clientId: "lead-2", rep: "" }, row), false);
});

test("rep filter matches only that rep's rows, exact name", () => {
  assert.equal(matchesClientRep({ clientId: "", rep: "Brendan" }, row), true);
  assert.equal(matchesClientRep({ clientId: "", rep: "Asher" }, row), false);
});

test("client and rep together must both match", () => {
  assert.equal(matchesClientRep({ clientId: "lead-1", rep: "Brendan" }, row), true);
  assert.equal(matchesClientRep({ clientId: "lead-1", rep: "Asher" }, row), false);
  assert.equal(matchesClientRep({ clientId: "lead-2", rep: "Brendan" }, row), false);
});

test("a row with no lead or no rep never matches an active filter", () => {
  assert.equal(matchesClientRep({ clientId: "lead-1", rep: "" }, { leadId: null, rep: "Brendan" }), false);
  assert.equal(matchesClientRep({ clientId: "", rep: "Brendan" }, { leadId: "lead-1", rep: null }), false);
});

/**
 * The six stat cards recompute under the same client/rep scope as the
 * tables, from the same rows the tables render — so the card and the
 * rows beneath it can never disagree. Semantics pinned against
 * collectionsSummary: collected counts only succeeded payments, clearing
 * only pending, billed counts billed+overdue phases (a clearing or paid
 * phase is not money still owed on a bill), and outstanding is signed
 * contract value minus collected, never negative.
 */

const lead1 = { leadId: "lead-1", rep: "Brendan" };
const lead2 = { leadId: "lead-2", rep: "Asher" };
const rows = {
  contracts: [
    { ...lead1, totalCents: 100_000 },
    { ...lead2, totalCents: 50_000 },
  ],
  billed: [
    { ...lead1, state: "overdue", amountCents: 7_000 },
    { ...lead1, state: "billed", amountCents: 3_000 },
    { ...lead1, state: "clearing", amountCents: 999 },
    { ...lead2, state: "overdue", amountCents: 4_000 },
    { ...lead2, state: "paid", amountCents: 2_000 },
  ],
  chase: [
    { ...lead1, depositCents: 1_000 },
    { ...lead2, depositCents: 2_500 },
  ],
  history: [
    { ...lead1, status: "succeeded", amountCents: 20_000 },
    { ...lead1, status: "pending", amountCents: 5_000 },
    { ...lead2, status: "succeeded", amountCents: 10_000 },
    { ...lead2, status: "failed", amountCents: 99_999 },
  ],
};

test("no filter: cards are the company-wide totals", () => {
  assert.deepEqual(paymentsSummary({ clientId: "", rep: "" }, rows), {
    collectedCents: 30_000,
    overdueCents: 11_000,
    billedCents: 14_000,
    outstandingCents: 120_000,
    awaitingDepositCents: 3_500,
    clearingCents: 5_000,
  });
});

test("client filter: every card is that client's money only", () => {
  assert.deepEqual(paymentsSummary({ clientId: "lead-1", rep: "" }, rows), {
    collectedCents: 20_000,
    overdueCents: 7_000,
    billedCents: 10_000,
    outstandingCents: 80_000,
    awaitingDepositCents: 1_000,
    clearingCents: 5_000,
  });
});

test("rep filter: every card is that rep's book only", () => {
  assert.deepEqual(paymentsSummary({ clientId: "", rep: "Asher" }, rows), {
    collectedCents: 10_000,
    overdueCents: 4_000,
    billedCents: 4_000,
    outstandingCents: 40_000,
    awaitingDepositCents: 2_500,
    clearingCents: 0,
  });
});

test("outstanding clamps at zero when collected exceeds signed value", () => {
  const s = paymentsSummary(
    { clientId: "lead-1", rep: "" },
    {
      contracts: [{ ...lead1, totalCents: 10_000 }],
      billed: [],
      chase: [],
      history: [{ ...lead1, status: "succeeded", amountCents: 15_000 }],
    }
  );
  assert.equal(s.outstandingCents, 0);
  assert.equal(s.collectedCents, 15_000);
});
