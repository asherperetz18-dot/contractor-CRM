import { test } from "node:test";
import assert from "node:assert/strict";
import { funnelCardStats, matchesRepFilter } from "./funnel-cards.ts";
import type { EstimateStatus } from "./types.ts";

/**
 * The money cards above the estimates list. Picking a salesperson in the
 * filter used to change only the table below -- the cards kept reporting
 * company-wide totals, so "Contracts $770,599" read as the selected
 * rep's number when it was everyone's.
 */

const doc = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over });
const base = () => ({
  kind: "contract",
  status: "Draft" as EstimateStatus,
  expires_at: null as string | null,
  total_cents: 10_000,
  rep: "asher" as string | null,
});
const repOf = (d: ReturnType<typeof base>) => d.rep;
const nobody = new Set<string>();

test("with no salesperson selected a card totals the whole company", () => {
  const docs = [doc(), doc({ rep: "brendan", total_cents: 25_000 })];
  assert.deepEqual(funnelCardStats(docs, "drafts", nobody, repOf), {
    count: 2,
    totalCents: 35_000,
  });
});

test("with a salesperson selected every card holds only that rep's documents", () => {
  const docs = [
    doc({ total_cents: 10_000 }),
    doc({ rep: "brendan", total_cents: 25_000 }),
    doc({ rep: "brendan", status: "Signed", total_cents: 40_000 }),
  ];
  const onlyAsher = new Set(["asher"]);
  assert.deepEqual(funnelCardStats(docs, "drafts", onlyAsher, repOf), {
    count: 1,
    totalCents: 10_000,
  });
  // A card the rep has nothing on reads zero rather than the company's
  // number -- that empty card is what tells the reader the rep has no
  // signed contracts, not that the filter stopped working.
  assert.deepEqual(funnelCardStats(docs, "signed", onlyAsher, repOf), {
    count: 0,
    totalCents: 0,
  });
});

test("a document with no salesperson drops out when a rep is selected", () => {
  // Same rule as the table rows: an unassigned draft is nobody's number.
  const docs = [doc({ rep: null })];
  assert.equal(funnelCardStats(docs, "drafts", nobody, repOf).count, 1);
  assert.equal(funnelCardStats(docs, "drafts", new Set(["asher"]), repOf).count, 0);
});

test("matchesRepFilter: empty filter admits everyone, a set filter needs a match", () => {
  assert.equal(matchesRepFilter(null, nobody), true);
  assert.equal(matchesRepFilter("asher", new Set(["asher"])), true);
  assert.equal(matchesRepFilter("brendan", new Set(["asher"])), false);
  assert.equal(matchesRepFilter(null, new Set(["asher"])), false);
});

// The rules that moved here from the view, kept behaving.

test("voided documents are counted but their money is not", () => {
  const stats = funnelCardStats([doc({ status: "Void" })], "void", nobody, repOf);
  assert.deepEqual(stats, { count: 1, totalCents: 0 });
});

test("Attached counts every change order but totals only the signed ones", () => {
  const docs = [
    doc({ kind: "change_order", status: "Sent", total_cents: 5_000 }),
    doc({ kind: "change_order", status: "Signed", total_cents: 7_500 }),
  ];
  assert.deepEqual(funnelCardStats(docs, "changes", nobody, repOf), {
    count: 2,
    totalCents: 7_500,
  });
});

test("Change Orders holds only pending ones -- a signed extra is money, not a chase", () => {
  const docs = [
    doc({ kind: "change_order", status: "Sent", total_cents: 5_000 }),
    doc({ kind: "change_order", status: "Signed", total_cents: 7_500 }),
  ];
  assert.deepEqual(funnelCardStats(docs, "co_pending", nobody, repOf), {
    count: 1,
    totalCents: 5_000,
  });
});

test("a lapsed expiry files a Sent document under Declined, not Proposals", () => {
  const docs = [doc({ status: "Sent", expires_at: "2000-01-01" })];
  assert.equal(funnelCardStats(docs, "sent", nobody, repOf).count, 0);
  assert.equal(funnelCardStats(docs, "declined", nobody, repOf).count, 1);
});
