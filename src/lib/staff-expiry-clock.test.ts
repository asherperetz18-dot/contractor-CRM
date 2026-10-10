import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { effectiveEstimateStatus, funnelCardStats, inFunnelBucket } from "./data/funnel-cards.ts";
import { isPendingChangeOrder } from "./data/pending-change-orders.ts";
import {
  boardCardStats,
  boardColumnFor,
  columnTotalCents,
  matchesScope,
  noReplyDays,
} from "../app/(app)/contracts/contract-board.ts";

/**
 * Estimates, Contracts and the Contract Board judged a proposal's expiry
 * by the clock where the page drew (DECISIONS #193): the server's UTC on
 * the first draw -- already tomorrow from 5pm Pacific -- then the
 * browser's. On a proposal's last evening the server's page filed it
 * under Lost and Closed while the browser said Sent, and the portal let
 * the customer sign. They now judge at noon of the company's today, as
 * the portal does (#191).
 */

function inZone<T>(zone: string, fn: () => T): T {
  const original = process.env.TZ;
  try {
    process.env.TZ = zone;
    return fn();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

const lastDay = {
  kind: "contract",
  status: "Sent" as const,
  expires_at: "2026-10-09",
  total_cents: 50_000,
  sent_at: "2026-09-01T17:00:00Z",
  viewed_at: null,
  signed_at: null,
};
const changeOrder = { ...lastDay, kind: "change_order" };
const none = new Set<string>();
const nobody = () => ["rep"];

test("on its last day a proposal is awaiting a signature everywhere, in any zone the page draws in", () => {
  for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    inZone(zone, () => {
      const asOf = new Date("2026-10-09T12:00:00");
      assert.equal(effectiveEstimateStatus(lastDay, asOf), "Sent", zone);
      assert.equal(inFunnelBucket(lastDay, "sent", asOf), true, zone);
      assert.equal(inFunnelBucket(lastDay, "declined", asOf), false, zone);
      assert.equal(isPendingChangeOrder(changeOrder, asOf), true, zone);
      assert.deepEqual(funnelCardStats([lastDay], "sent", none, nobody, asOf), { count: 1, totalCents: 50_000 }, zone);
      assert.equal(boardColumnFor(lastDay, asOf), "sent", zone);
      // And lapsed from the next day.
      const next = new Date("2026-10-10T12:00:00");
      assert.equal(effectiveEstimateStatus(lastDay, next), "Expired", zone);
      assert.equal(isPendingChangeOrder(changeOrder, next), false, zone);
    });
  }
});

test("a column's money, and the board's cards, judge expiry on the same day", () => {
  const voided = { ...lastDay, status: "Void" as const, expires_at: null };
  inZone("UTC", () => {
    const asOf = new Date("2026-10-09T12:00:00");
    assert.equal(columnTotalCents([lastDay, voided], asOf), 50_000);
    // The real instant is already the 10th in UTC (6pm Pacific on the 9th);
    // the expiry day is the company's.
    const now = new Date("2026-10-10T01:00:00Z");
    assert.equal(matchesScope(lastDay, "awaiting", now, asOf), true);
    assert.equal(matchesScope(lastDay, "expiring", now, asOf), true);
    assert.equal(boardCardStats([lastDay], now, asOf).awaiting.count, 1);
    assert.equal(boardCardStats([lastDay], now, asOf).expiring.count, 1);
  });
});

test("no reply counts days from the real moment; only its expiry check moves", () => {
  inZone("UTC", () => {
    const now = new Date("2026-10-10T01:00:00Z");
    const asOf = new Date("2026-10-09T12:00:00");
    // 38 days and 8 hours since it was sent, still awaiting on the company's day.
    assert.equal(noReplyDays(lastDay, now, asOf), 38);
    // Judged by the instant alone it had already expired and owed no reply.
    assert.equal(noReplyDays(lastDay, now), null);
  });
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Estimates judges expiry on the company's today", () => {
  const view = source("../app/(app)/estimates/estimates-view.tsx");
  assert.match(view, /const asOf = new Date\(`\$\{today\}T12:00:00`\);/);
  assert.match(view, /funnelCardStats\(scoped, b\.key, repFilter, peopleFor, asOf\)/);
  assert.match(view, /estimates\.filter\(\(e\) => inFunnelBucket\(e, active\.key, asOf\)\)/);
  assert.match(view, /scoped\.filter\(\(e\) => inFunnelBucket\(e, active\.key, asOf\)\)/);
  assert.doesNotMatch(view, /effectiveEstimateStatus\(e\)/);
  assert.equal((view.match(/effectiveEstimateStatus\(e, asOf\)/g) ?? []).length, 3);
});

test("the Contract Board judges expiry on the company's today, and keeps the real moment for durations", () => {
  const view = source("../app/(app)/contracts/contracts-view.tsx");
  assert.match(view, /const asOf = new Date\(`\$\{today\}T12:00:00`\);/);
  assert.doesNotMatch(view, /boardColumnFor\(e\)/);
  assert.equal((view.match(/boardColumnFor\(e, asOf\)/g) ?? []).length, 2);
  assert.match(view, /boardCardStats\(filtered, now, asOf\)/);
  assert.match(view, /matchesScope\(e, scope, now, asOf\)/);
  assert.match(view, /columnTotalCents\(docs, asOf\)/);
  assert.match(view, /effectiveEstimateStatus\(e, asOf\)/);
  assert.match(view, /daysUntilExpiry\(e, asOf\)/);
  assert.match(view, /noReplyDays\(e, now, asOf\)/);
});
