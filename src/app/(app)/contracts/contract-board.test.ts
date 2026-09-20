import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avgDaysToSign,
  boardCardStats,
  boardColumnFor,
  columnTotalCents,
  daysUntilExpiry,
  isExpiringSoon,
  matchesBoardSearch,
  matchesScope,
  noReplyDays,
  signedThisMonth,
} from "./contract-board.ts";
import type { EstimateStatus } from "../../../lib/data/types.ts";

/**
 * The Contract Board's rules: which column a contract stands in, what
 * the stat cards total, and which cards deserve an attention chip. The
 * clock is always a parameter -- every rule here is about elapsed time,
 * and a test that reads the wall clock rots.
 */

const NOW = new Date("2026-09-20T12:00:00");

const doc = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over });
const base = () => ({
  kind: "contract",
  status: "Draft" as EstimateStatus,
  expires_at: null as string | null,
  total_cents: 10_000,
  sent_at: null as string | null,
  viewed_at: null as string | null,
  signed_at: null as string | null,
});

test("each status stands in its own column; end states share Closed", () => {
  assert.equal(boardColumnFor(doc()), "draft");
  assert.equal(boardColumnFor(doc({ status: "Sent" })), "sent");
  assert.equal(boardColumnFor(doc({ status: "Viewed" })), "viewed");
  assert.equal(boardColumnFor(doc({ status: "Signed" })), "signed");
  assert.equal(boardColumnFor(doc({ status: "Declined" })), "closed");
  assert.equal(boardColumnFor(doc({ status: "Expired" })), "closed");
  assert.equal(boardColumnFor(doc({ status: "Void" })), "closed");
});

test("change orders and completion certificates are not board cards", () => {
  // They attach to a contract; the board tracks the contract itself.
  assert.equal(boardColumnFor(doc({ kind: "change_order", status: "Sent" })), null);
  assert.equal(boardColumnFor(doc({ kind: "completion" })), null);
});

test("a lapsed expiry moves a Sent contract to Closed, not a Signed one", () => {
  // Same overlay the estimates funnel applies: nothing sweeps the table
  // on a timer, so the column must believe the expiry date.
  assert.equal(boardColumnFor(doc({ status: "Sent", expires_at: "2000-01-01" })), "closed");
  assert.equal(boardColumnFor(doc({ status: "Signed", expires_at: "2000-01-01" })), "signed");
});

test("a column's money excludes voided contracts -- cancelled work is not money", () => {
  const docs = [
    doc({ status: "Declined", total_cents: 5_000 }),
    doc({ status: "Expired", total_cents: 3_000 }),
    doc({ status: "Void", total_cents: 7_000 }),
  ];
  assert.equal(columnTotalCents(docs), 8_000);
});

test("days until expiry counts only for documents still awaiting signature", () => {
  assert.equal(daysUntilExpiry(doc({ status: "Sent", expires_at: "2026-09-24" }), NOW), 4);
  // Expiring today reads 0, not 1 -- "expires in 0d" is today's chase.
  assert.equal(daysUntilExpiry(doc({ status: "Sent", expires_at: "2026-09-20" }), NOW), 0);
  assert.equal(daysUntilExpiry(doc({ status: "Viewed", expires_at: "2026-09-24" }), NOW), 4);
  // A draft's expiry date is a setting, not a countdown; signed never expires.
  assert.equal(daysUntilExpiry(doc({ expires_at: "2026-09-24" }), NOW), null);
  assert.equal(daysUntilExpiry(doc({ status: "Signed", expires_at: "2026-09-24" }), NOW), null);
  assert.equal(daysUntilExpiry(doc({ status: "Sent" }), NOW), null);
});

test("expiring soon means within seven days, awaiting signature", () => {
  assert.equal(isExpiringSoon(doc({ status: "Sent", expires_at: "2026-09-24" }), NOW), true);
  assert.equal(isExpiringSoon(doc({ status: "Sent", expires_at: "2026-09-27" }), NOW), true);
  assert.equal(isExpiringSoon(doc({ status: "Sent", expires_at: "2026-09-28" }), NOW), false);
  assert.equal(isExpiringSoon(doc({ expires_at: "2026-09-24" }), NOW), false);
});

test("signed this month is the calendar month, not the last 30 days", () => {
  assert.equal(signedThisMonth(doc({ status: "Signed", signed_at: "2026-09-01T08:00:00" }), NOW), true);
  assert.equal(signedThisMonth(doc({ status: "Signed", signed_at: "2026-08-31T23:00:00" }), NOW), false);
  assert.equal(signedThisMonth(doc({ status: "Sent", signed_at: "2026-09-01T08:00:00" }), NOW), false);
  assert.equal(signedThisMonth(doc({ status: "Signed" }), NOW), false);
});

test("no-reply flags a Sent contract the customer has ignored for 14+ days", () => {
  assert.equal(noReplyDays(doc({ status: "Sent", sent_at: "2026-08-25T12:00:00" }), NOW), 26);
  assert.equal(noReplyDays(doc({ status: "Sent", sent_at: "2026-09-10T12:00:00" }), NOW), null);
  // Once the customer opened it, the silence is a different conversation.
  assert.equal(
    noReplyDays(doc({ status: "Viewed", sent_at: "2026-08-25T12:00:00", viewed_at: "2026-09-01" }), NOW),
    null
  );
  // An expired document is over; nobody is owed a reply on it.
  assert.equal(
    noReplyDays(doc({ status: "Sent", sent_at: "2026-08-25T12:00:00", expires_at: "2026-09-10" }), NOW),
    null
  );
});

test("average days to sign: sent-to-signed, over the last 90 days only", () => {
  const docs = [
    doc({ status: "Signed", sent_at: "2026-09-04T10:00:00", signed_at: "2026-09-10T10:00:00" }),
    doc({ status: "Signed", sent_at: "2026-08-01T10:00:00", signed_at: "2026-08-11T10:00:00" }),
    // Signed before the window opened -- last year's sales pace is not
    // an answer to "how fast are we closing lately".
    doc({ status: "Signed", sent_at: "2026-04-01T10:00:00", signed_at: "2026-05-01T10:00:00" }),
    doc({ status: "Sent", sent_at: "2026-09-04T10:00:00" }),
    // Signed on paper without ever being sent -- no interval to measure.
    doc({ status: "Signed", signed_at: "2026-09-10T10:00:00" }),
  ];
  assert.equal(avgDaysToSign(docs, NOW), 8);
  assert.equal(avgDaysToSign([], NOW), null);
});

test("a stat card's scope narrows the board to the rows it counted", () => {
  const sent = doc({ status: "Sent" });
  const signed = doc({ status: "Signed", signed_at: "2026-09-05T10:00:00" });
  const expiring = doc({ status: "Sent", expires_at: "2026-09-22" });
  assert.equal(matchesScope(sent, null, NOW), true);
  assert.equal(matchesScope(sent, "awaiting", NOW), true);
  assert.equal(matchesScope(doc({ status: "Viewed" }), "awaiting", NOW), true);
  assert.equal(matchesScope(signed, "awaiting", NOW), false);
  assert.equal(matchesScope(signed, "signedMonth", NOW), true);
  assert.equal(matchesScope(sent, "signedMonth", NOW), false);
  assert.equal(matchesScope(expiring, "expiring", NOW), true);
  assert.equal(matchesScope(sent, "expiring", NOW), false);
});

test("the stat cards total exactly the docs they are given", () => {
  // Fed the FILTERED list, so the cards always speak for the same slice
  // as the board below -- the estimates funnel's rule.
  const stats = boardCardStats(
    [
      doc({ status: "Sent", total_cents: 20_000 }),
      doc({ status: "Viewed", total_cents: 30_000 }),
      doc({ status: "Sent", total_cents: 5_000, expires_at: "2026-09-22" }),
      doc({
        status: "Signed",
        total_cents: 40_000,
        sent_at: "2026-09-01T10:00:00",
        signed_at: "2026-09-05T10:00:00",
      }),
      doc({ status: "Declined", total_cents: 99_000 }),
      // A change order slipping in must not count anywhere.
      doc({ kind: "change_order", status: "Sent", total_cents: 77_000 }),
    ],
    NOW
  );
  assert.deepEqual(stats.awaiting, { count: 3, totalCents: 55_000 });
  assert.deepEqual(stats.signedMonth, { count: 1, totalCents: 40_000 });
  assert.deepEqual(stats.expiring, { count: 1, totalCents: 5_000 });
  assert.equal(stats.avgDays, 4);
});

test("search matches text across the card and amounts by digits", () => {
  const card = {
    docNumber: "EST-1068",
    customer: "Maria Delgado",
    title: "Bathroom Remodel",
    address: "412 Palm Ave",
    repName: "Asher Peretz",
    totalCents: 1_890_000,
  };
  assert.equal(matchesBoardSearch(card, ""), true);
  assert.equal(matchesBoardSearch(card, "delgado"), true);
  assert.equal(matchesBoardSearch(card, "1068"), true);
  assert.equal(matchesBoardSearch(card, "palm"), true);
  assert.equal(matchesBoardSearch(card, "$18,900"), true);
  assert.equal(matchesBoardSearch(card, "zzz"), false);
  // A single digit never triggers amount matching -- it would hit almost
  // every total. (The card's text is stripped of 1s so only the cents
  // integer, 1890000, could match.)
  assert.equal(
    matchesBoardSearch({ ...card, docNumber: "Q-9", address: "42 Palm Ave" }, "1"),
    false
  );
});
