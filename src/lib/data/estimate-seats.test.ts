import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateSeats } from "./estimate-seats.ts";
import type { EstimateStatus } from "./types.ts";

/**
 * Everyone on a document's sales team. The Estimates page's salesperson
 * filter used to read only the salesperson column, so picking Simon
 * left out EST-1068 -- Rafi's contract, closed by Simon. A closer or a
 * second salesperson worked the job too and is looking for it.
 */

const doc = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over });
const base = () => ({
  status: "Signed" as EstimateStatus,
  assigned_to: "rafi" as string | null,
  sales_rep_1: null as string | null,
  sales_rep_2: null as string | null,
  closer_id: null as string | null,
});
const lead = (over: { assigned_to?: string | null; partner_rep_id?: string | null; closer_id?: string | null } = {}) => ({
  assigned_to: "rafi" as string | null,
  partner_rep_id: null as string | null,
  closer_id: null as string | null,
  ...over,
});

test("a signed contract names its closer seat -- the EST-1068 case", () => {
  const seats = estimateSeats(doc({ sales_rep_1: "rafi", closer_id: "simon" }), lead());
  assert.deepEqual(seats, [
    { id: "rafi", role: "Salesperson" },
    { id: "simon", role: "Closer" },
  ]);
});

test("a signed contract names its second salesperson seat, even at a 0% share", () => {
  // Contracts signed before the closer seat existed (0153) carry their
  // closer here -- the panel shows them in this seat, and so do we.
  const seats = estimateSeats(doc({ sales_rep_1: "rafi", sales_rep_2: "asher" }), lead());
  assert.deepEqual(seats, [
    { id: "rafi", role: "Salesperson" },
    { id: "asher", role: "Second salesperson" },
  ]);
});

test("a signed contract reads its own seats, not a lead reassigned since", () => {
  const seats = estimateSeats(
    doc({ sales_rep_1: "rafi", closer_id: "simon" }),
    lead({ assigned_to: "josh", closer_id: "frank", partner_rep_id: "gabe" })
  );
  assert.deepEqual(seats.map((s) => s.id), ["rafi", "simon"]);
});

test("a signed contract nobody seated falls back to the lead's team, as the panel does", () => {
  // Signed before the seeding trigger: the Sales team panel previews the
  // lead's people, so the list must find the same ones.
  const seats = estimateSeats(doc(), lead({ closer_id: "simon", partner_rep_id: "asher" }));
  assert.deepEqual(seats, [
    { id: "rafi", role: "Salesperson" },
    { id: "asher", role: "Second salesperson" },
    { id: "simon", role: "Closer" },
  ]);
});

test("an unsigned document follows the lead's whole team", () => {
  const seats = estimateSeats(
    doc({ status: "Sent", assigned_to: "vanessa" }),
    lead({ assigned_to: "rafi", closer_id: "simon" })
  );
  // The salesperson is whoever holds the lead now (effectiveEstimateRepId),
  // not the dispatcher who raised the draft.
  assert.deepEqual(seats, [
    { id: "rafi", role: "Salesperson" },
    { id: "simon", role: "Closer" },
  ]);
});

test("the salesperson column's rep always comes first, and nobody is listed twice", () => {
  // Signed and stamped to Rafi, while the office moved seat one to Josh:
  // both are on this contract, the column's name first.
  const seats = estimateSeats(doc({ sales_rep_1: "josh", sales_rep_2: "rafi" }), lead());
  assert.deepEqual(seats, [
    { id: "rafi", role: "Salesperson" },
    { id: "josh", role: "Salesperson" },
  ]);
  // The closer who is also the rep is one person, not two rows.
  assert.deepEqual(
    estimateSeats(doc({ status: "Draft" }), lead({ closer_id: "rafi" })),
    [{ id: "rafi", role: "Salesperson" }]
  );
});

test("a document with nobody on it has no seats", () => {
  assert.deepEqual(estimateSeats(doc({ assigned_to: null }), undefined), []);
  assert.deepEqual(estimateSeats(doc({ status: "Draft", assigned_to: null }), lead({ assigned_to: null })), []);
});
