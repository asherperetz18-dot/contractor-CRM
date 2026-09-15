import { test } from "node:test";
import assert from "node:assert/strict";
import { changeOrderBillingFromPayments, reportPhaseStatus } from "./report-schedule.ts";

/**
 * The project report's payment schedule listed every phase of the contract
 * AND every phase of each change order. A signed change order is already
 * one mirror row on the contract's schedule, so its own rows duplicated
 * it -- and whichever side the money was not filed to read "Not yet
 * billed" over cash in hand (Patty Munoz: two paid change orders, and two
 * dangling "Upon Completion" rows saying not billed). The report now
 * shows the contract's schedule only, with each mirror row's status read
 * through the change order's own billing.
 */

const phase = (
  over: Partial<{
    id: string;
    name: string;
    amount_cents: number;
    requested_at: string | null;
  }> = {}
) => ({
  id: "phase-1",
  name: "EST-1098-CO1",
  amount_cents: 250000,
  requested_at: null,
  ...over,
});

test("payments filed straight to the phase decide its status first", () => {
  const paid = [
    { estimate_payment_id: "phase-1", status: "succeeded" as const, amount_cents: 250000 },
  ];
  assert.deepEqual(reportPhaseStatus(phase(), paid, []), { kind: "paid" });

  const half = [
    { estimate_payment_id: "phase-1", status: "succeeded" as const, amount_cents: 100000 },
  ];
  assert.deepEqual(reportPhaseStatus(phase(), half, []), {
    kind: "partial",
    paidCents: 100000,
  });
});

test("a mirror row paid on the change order's own schedule reads paid, not unbilled", () => {
  // The other half of the same bug, already fixed on the estimate page but
  // not the report: money collected on the change order's own phases left
  // the contract's mirror row saying "Not yet billed".
  const orders = [{ doc_number: "EST-1098-CO1", paid_cents: 250000, pending_cents: 0 }];
  assert.deepEqual(reportPhaseStatus(phase(), [], orders), {
    kind: "paid",
    via: "EST-1098-CO1",
  });

  const partial = [{ doc_number: "EST-1098-CO1", paid_cents: 100000, pending_cents: 0 }];
  assert.deepEqual(reportPhaseStatus(phase(), [], partial), {
    kind: "partial",
    paidCents: 100000,
    via: "EST-1098-CO1",
  });

  const clearing = [{ doc_number: "EST-1098-CO1", paid_cents: 0, pending_cents: 100000 }];
  assert.deepEqual(reportPhaseStatus(phase(), [], clearing), {
    kind: "clearing",
    pendingCents: 100000,
    via: "EST-1098-CO1",
  });
});

test("no money anywhere: billed when requested, otherwise not yet billed", () => {
  assert.deepEqual(reportPhaseStatus(phase(), [], []), { kind: "unbilled" });
  assert.deepEqual(
    reportPhaseStatus(phase({ requested_at: "2026-09-11T00:00:00Z" }), [], []),
    { kind: "billed", requestedAt: "2026-09-11T00:00:00Z" }
  );
});

test("an ordinary phase never picks up change-order money", () => {
  const orders = [{ doc_number: "EST-1098-CO1", paid_cents: 250000, pending_cents: 0 }];
  assert.deepEqual(reportPhaseStatus(phase({ name: "Upon Completion" }), [], orders), {
    kind: "unbilled",
  });
});

test("billing rolls up per change order from its own settled and pending payments", () => {
  const orders = [
    { id: "co-1", doc_number: "EST-1098-CO1" },
    { id: "co-2", doc_number: "EST-1098-CO2" },
  ];
  const payments = [
    { estimate_id: "co-1", status: "succeeded" as const, amount_cents: 150000 },
    { estimate_id: "co-1", status: "succeeded" as const, amount_cents: 100000 },
    { estimate_id: "co-1", status: "pending" as const, amount_cents: 5000 },
    // A failed payment is not money and must not count either way.
    { estimate_id: "co-2", status: "failed" as const, amount_cents: 99999 },
    // The contract's own payments belong to no change order.
    { estimate_id: "contract-1", status: "succeeded" as const, amount_cents: 700000 },
  ];
  assert.deepEqual(changeOrderBillingFromPayments(orders, payments), [
    { doc_number: "EST-1098-CO1", paid_cents: 250000, pending_cents: 5000 },
    { doc_number: "EST-1098-CO2", paid_cents: 0, pending_cents: 0 },
  ]);
});
