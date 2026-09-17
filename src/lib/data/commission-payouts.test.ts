import { test } from "node:test";
import assert from "node:assert/strict";
import {
  repBalances,
  balanceTotals,
  periodBalance,
  periodBalancesByRep,
  type CommissionLineLike,
  type PayoutLike,
} from "./commission-payouts.ts";

/**
 * The payout ledger's arithmetic. Commission is computed live from the
 * contracts, and this file is the other half: what has actually been
 * handed to each rep -- payouts and advances -- and therefore what is
 * still DUE. This is payroll, so the edges are tested rather than
 * assumed: netting one rep's overpay against another's wages, or an
 * advance quietly vanishing between periods, is somebody's pay.
 */

const line = (over: Partial<CommissionLineLike> = {}): CommissionLineLike => ({
  repId: "rep-a",
  shareCents: 100_000,
  payable: true,
  qualifiedAt: "2026-08-15T10:00:00Z",
  unmeasured: false,
  ...over,
});

const paid = (over: Partial<PayoutLike> = {}): PayoutLike => ({
  repId: "rep-a",
  amountCents: 40_000,
  paidOn: "2026-08-20",
  kind: "payout",
  ...over,
});

// ── All-time balances (the page's cards and per-rep summary) ─────────

test("a payout reduces what is due, never what was earned", () => {
  const b = repBalances([line()], [paid()]).get("rep-a");
  assert.equal(b?.earnedCents, 100_000);
  assert.equal(b?.payableCents, 100_000);
  assert.equal(b?.paidCents, 40_000);
  assert.equal(b?.dueCents, 60_000);
  assert.equal(b?.aheadCents, 0);
});

test("an advance is money already handed over, and is also counted apart", () => {
  const b = repBalances(
    [line()],
    [paid({ kind: "advance", amountCents: 30_000 }), paid({ amountCents: 20_000 })]
  ).get("rep-a");
  assert.equal(b?.paidCents, 50_000);
  assert.equal(b?.advanceCents, 30_000);
  assert.equal(b?.dueCents, 50_000);
});

test("an advance beyond what is payable nets against the next job, not a debt shown as due", () => {
  const b = repBalances(
    [line({ shareCents: 20_000 })],
    [paid({ kind: "advance", amountCents: 50_000 })]
  ).get("rep-a");
  assert.equal(b?.dueCents, 0);
  assert.equal(b?.aheadCents, 30_000);
});

test("held commission is earned but not yet due, so an advance against it runs ahead", () => {
  const b = repBalances(
    [line({ payable: false, qualifiedAt: null, shareCents: 80_000 })],
    [paid({ kind: "advance", amountCents: 10_000 })]
  ).get("rep-a");
  assert.equal(b?.earnedCents, 80_000);
  assert.equal(b?.payableCents, 0);
  assert.equal(b?.dueCents, 0);
  assert.equal(b?.aheadCents, 10_000);
});

test("an unmeasured job promises nothing -- not even 'earned'", () => {
  const b = repBalances(
    [line({ unmeasured: true, payable: false, qualifiedAt: null })],
    []
  ).get("rep-a");
  assert.equal(b?.earnedCents, 0);
  assert.equal(b?.payableCents, 0);
});

test("a payment to a rep with no commission lines still shows on their balance", () => {
  const b = repBalances([], [paid({ kind: "advance" })]).get("rep-a");
  assert.equal(b?.paidCents, 40_000);
  assert.equal(b?.aheadCents, 40_000);
});

test("balances split by rep, and one rep's overpay never pays another's wages", () => {
  const balances = repBalances(
    [line({ repId: "rep-a", shareCents: 50_000 }), line({ repId: "rep-b", payable: false, qualifiedAt: null })],
    [paid({ repId: "rep-b", kind: "advance", amountCents: 20_000 })]
  );
  assert.equal(balances.get("rep-a")?.dueCents, 50_000);
  assert.equal(balances.get("rep-b")?.aheadCents, 20_000);

  // Summed for the cards: the company owes A $500 whatever it has
  // advanced B. Netting the two would print a payroll $200 short.
  const totals = balanceTotals(balances.values());
  assert.equal(totals.dueCents, 50_000);
  assert.equal(totals.aheadCents, 20_000);
  assert.equal(totals.paidCents, 20_000);
});

// ── One period (the printable statement) ─────────────────────────────
//
// The statement reads like a bank statement: what was carried in, what
// came due this period, what was paid this period, and the balance. A
// job qualifies on the day its last gate cleared; money counts on the
// day it moved.

test("carried in, came due, paid, balance", () => {
  const p = periodBalance(
    [
      line({ qualifiedAt: "2026-08-15T10:00:00Z", shareCents: 100_000 }),
      line({ qualifiedAt: "2026-09-10T10:00:00Z", shareCents: 50_000 }),
    ],
    [paid({ paidOn: "2026-08-20", amountCents: 60_000 }), paid({ paidOn: "2026-09-05", amountCents: 30_000 })],
    "2026-09-01",
    "2026-09-30"
  );
  assert.equal(p.openingCents, 40_000);
  assert.equal(p.qualifiedCents, 50_000);
  assert.equal(p.paidCents, 30_000);
  assert.equal(p.closingCents, 60_000);
});

test("the period is inclusive at both ends", () => {
  const p = periodBalance(
    [
      line({ qualifiedAt: "2026-09-01T00:00:00Z", shareCents: 10_000 }),
      line({ qualifiedAt: "2026-09-30T23:00:00Z", shareCents: 20_000 }),
    ],
    [paid({ paidOn: "2026-09-01", amountCents: 1_000 }), paid({ paidOn: "2026-09-30", amountCents: 2_000 })],
    "2026-09-01",
    "2026-09-30"
  );
  assert.equal(p.qualifiedCents, 30_000);
  assert.equal(p.paidCents, 3_000);
});

test("what qualifies after the period is the next statement's, not carried in early", () => {
  const p = periodBalance(
    [line({ qualifiedAt: "2026-10-02T10:00:00Z" })],
    [paid({ paidOn: "2026-10-05" })],
    "2026-09-01",
    "2026-09-30"
  );
  assert.equal(p.openingCents, 0);
  assert.equal(p.qualifiedCents, 0);
  assert.equal(p.paidCents, 0);
  assert.equal(p.closingCents, 0);
});

test("held commission is not on the statement's balance at all", () => {
  const p = periodBalance(
    [line({ payable: false, qualifiedAt: null, shareCents: 500_000 })],
    [],
    "2026-09-01",
    "2026-09-30"
  );
  assert.equal(p.openingCents, 0);
  assert.equal(p.qualifiedCents, 0);
});

test("a payable line with no qualifying date is carried in rather than lost", () => {
  // Rare: the gates cleared but neither cleared with a usable date.
  // The money is owed; the only honest place for it is the opening
  // balance, where it appears on every statement until paid.
  const p = periodBalance(
    [line({ qualifiedAt: null, shareCents: 70_000 })],
    [],
    "2026-09-01",
    "2026-09-30"
  );
  assert.equal(p.openingCents, 70_000);
  assert.equal(p.closingCents, 70_000);
});

test("advances count against the balance the same as payouts, and can run it negative", () => {
  const p = periodBalance(
    [line({ qualifiedAt: "2026-09-10T10:00:00Z", shareCents: 30_000 })],
    [paid({ kind: "advance", paidOn: "2026-09-12", amountCents: 45_000 })],
    "2026-09-01",
    "2026-09-30"
  );
  assert.equal(p.closingCents, -15_000);
});

test("the by-rep period balances keep each rep's statement their own", () => {
  const byRep = periodBalancesByRep(
    [
      line({ repId: "rep-a", qualifiedAt: "2026-09-10T10:00:00Z", shareCents: 50_000 }),
      line({ repId: "rep-b", qualifiedAt: "2026-08-01T10:00:00Z", shareCents: 40_000 }),
    ],
    [paid({ repId: "rep-b", paidOn: "2026-09-02", amountCents: 40_000 })],
    "2026-09-01",
    "2026-09-30"
  );
  assert.deepEqual(byRep.get("rep-a"), {
    openingCents: 0,
    qualifiedCents: 50_000,
    paidCents: 0,
    closingCents: 50_000,
  });
  assert.deepEqual(byRep.get("rep-b"), {
    openingCents: 40_000,
    qualifiedCents: 0,
    paidCents: 40_000,
    closingCents: 0,
  });
});
