import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FOLLOW_UP_CHIPS,
  followUpClock,
  matchesEstimateSearch,
  matchesFollowUpChip,
  sortEstimates,
  type EstimateSearchFields,
} from "./estimate-list-filters.ts";

/**
 * The filter bar over the Estimates & Contracts list: one search box, a
 * date range, and follow-up chips that change with the card. Before it,
 * finding "the Jeff Vance addition" among 75 documents meant scrolling.
 */

const fields = (over: Partial<EstimateSearchFields> = {}): EstimateSearchFields => ({
  docNumber: "EST-1116",
  customer: "Jeff Vance",
  email: "Jchristophervance@gmail.com",
  title: "1,200 Sq. Ft. Addition",
  address: "1231 Poinsettia Dr, West Hollywood, CA 90046, USA",
  jobAddress: null,
  ...over,
});

test("an empty search matches every document", () => {
  assert.equal(matchesEstimateSearch(fields(), ""), true);
  assert.equal(matchesEstimateSearch(fields(), "   "), true);
});

test("search finds a document by customer, doc number, title, email or address", () => {
  assert.equal(matchesEstimateSearch(fields(), "vance"), true);
  assert.equal(matchesEstimateSearch(fields(), "EST-1116"), true);
  // The number alone, as people say it out loud.
  assert.equal(matchesEstimateSearch(fields(), "1116"), true);
  assert.equal(matchesEstimateSearch(fields(), "addition"), true);
  assert.equal(matchesEstimateSearch(fields(), "gmail"), true);
  assert.equal(matchesEstimateSearch(fields(), "poinsettia"), true);
  assert.equal(matchesEstimateSearch(fields(), "guerrero"), false);
});

test("search ignores case and needs every word to appear somewhere", () => {
  // "vance addition" is a customer word plus a title word: both halves
  // of what the person remembers, not one phrase in one field.
  assert.equal(matchesEstimateSearch(fields(), "VANCE addition"), true);
  assert.equal(matchesEstimateSearch(fields(), "vance kitchen"), false);
});

test("search reads the job address when the work is somewhere else", () => {
  const rental = fields({ jobAddress: "44 Rental Ct, Burbank, CA" });
  assert.equal(matchesEstimateSearch(rental, "rental ct"), true);
  // The client's own address still finds it too.
  assert.equal(matchesEstimateSearch(rental, "poinsettia"), true);
});

test("missing fields never break the search", () => {
  const bare = fields({ email: null, address: null, title: "" });
  assert.equal(matchesEstimateSearch(bare, "vance"), true);
  assert.equal(matchesEstimateSearch(bare, "gmail"), false);
});

test("each card offers only the follow-up chips that mean something there", () => {
  assert.deepEqual(FOLLOW_UP_CHIPS.drafts, ["no_price", "stale_draft"]);
  assert.deepEqual(FOLLOW_UP_CHIPS.sent, ["not_opened", "opened_often", "expiring_soon"]);
  // A signed contract has nobody left to chase.
  assert.deepEqual(FOLLOW_UP_CHIPS.signed, []);
});

// The company's today, on UTC's calendar for the fixtures below.
const now = followUpClock("2026-09-28", "UTC");
const doc = (over: Partial<Parameters<typeof matchesFollowUpChip>[0]> = {}) => ({
  total_cents: 2_800_000,
  created_at: "2026-09-25T18:00:00Z",
  expires_at: null as string | null,
  views: 0,
  ...over,
});

test("No price yet catches a draft with no total", () => {
  assert.equal(matchesFollowUpChip(doc({ total_cents: 0 }), "no_price", now), true);
  assert.equal(matchesFollowUpChip(doc(), "no_price", now), false);
});

test("Older than 7 days catches a draft left sitting a week", () => {
  assert.equal(matchesFollowUpChip(doc({ created_at: "2026-09-19T10:00:00Z" }), "stale_draft", now), true);
  // Exactly a week old is still this week's work.
  assert.equal(matchesFollowUpChip(doc({ created_at: "2026-09-21T10:00:00Z" }), "stale_draft", now), false);
  assert.equal(matchesFollowUpChip(doc(), "stale_draft", now), false);
});

test("Not opened and Opened 3+ times read the customer's views", () => {
  assert.equal(matchesFollowUpChip(doc({ views: 0 }), "not_opened", now), true);
  assert.equal(matchesFollowUpChip(doc({ views: 1 }), "not_opened", now), false);
  assert.equal(matchesFollowUpChip(doc({ views: 3 }), "opened_often", now), true);
  assert.equal(matchesFollowUpChip(doc({ views: 2 }), "opened_often", now), false);
});

test("Older than 7 days counts the company's days, evenings included", () => {
  // Oct 8 in Los Angeles: a week back is Oct 1, which starts at 07:00 UTC.
  const la = followUpClock("2026-10-08", "America/Los_Angeles");
  // Sep 30 at 8pm there -- UTC already called it Oct 1, a week old.
  assert.equal(matchesFollowUpChip(doc({ created_at: "2026-10-01T03:00:00Z" }), "stale_draft", la), true);
  // Oct 1 at 12:30am there: exactly a week old, still this week's work.
  assert.equal(matchesFollowUpChip(doc({ created_at: "2026-10-01T07:30:00Z" }), "stale_draft", la), false);
});

test("Expires within 7 days counts today through a week out", () => {
  const exp = (expires_at: string | null) => doc({ expires_at });
  assert.equal(matchesFollowUpChip(exp("2026-09-28"), "expiring_soon", now), true);
  assert.equal(matchesFollowUpChip(exp("2026-10-05"), "expiring_soon", now), true);
  assert.equal(matchesFollowUpChip(exp("2026-10-06"), "expiring_soon", now), false);
  // Already lapsed is Expired, not "expiring".
  assert.equal(matchesFollowUpChip(exp("2026-09-27"), "expiring_soon", now), false);
  assert.equal(matchesFollowUpChip(exp(null), "expiring_soon", now), false);
});

const rows = [
  { id: "a", created_at: "2026-09-20T10:00:00Z", total_cents: 500 },
  { id: "b", created_at: "2026-09-27T10:00:00Z", total_cents: 0 },
  { id: "c", created_at: "2026-09-22T10:00:00Z", total_cents: 46_800_000 },
];
const views: Record<string, number> = { a: 5, c: 1 };
const viewsOf = (r: { id: string }) => views[r.id] ?? 0;
const ids = (list: { id: string }[]) => list.map((r) => r.id);

test("sorting by date runs newest first, and flips", () => {
  assert.deepEqual(ids(sortEstimates(rows, { key: "date", dir: "desc" }, viewsOf)), ["b", "c", "a"]);
  assert.deepEqual(ids(sortEstimates(rows, { key: "date", dir: "asc" }, viewsOf)), ["a", "c", "b"]);
});

test("sorting by total puts the biggest job on top", () => {
  assert.deepEqual(ids(sortEstimates(rows, { key: "total", dir: "desc" }, viewsOf)), ["c", "a", "b"]);
});

test("sorting by views puts the customer who keeps reopening on top", () => {
  assert.deepEqual(ids(sortEstimates(rows, { key: "views", dir: "desc" }, viewsOf)), ["a", "c", "b"]);
});

test("sorting never reorders the caller's list", () => {
  const before = ids(rows);
  sortEstimates(rows, { key: "total", dir: "desc" }, viewsOf);
  assert.deepEqual(ids(rows), before);
});
