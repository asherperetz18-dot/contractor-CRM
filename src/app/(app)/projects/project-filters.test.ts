import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chipMatches,
  dateRangeBounds,
  matchesProjectFilters,
  projectClock,
  projectTotals,
} from "./project-filters.ts";
import type { ProjectCard } from "./projects-view";

/**
 * The "New this month" chip counts jobs signed this calendar month --
 * its label carries the count, and clicking it must select exactly
 * those jobs, or the chip says 8 and the click shows some other list.
 * (Its stat card gave way to the Net accrual card; the chip is now the
 * one home of this count.)
 */

const card = (over: Partial<ProjectCard>): ProjectCard =>
  ({
    status: "in_progress",
    signedAt: null,
    rollup: { netCashCents: 0, receivableCents: 0 },
    ...over,
  }) as ProjectCard;

// The company's today, on UTC's calendar for the fixtures below.
const NOW = projectClock("2026-09-17", "UTC");

test("NewMonth keeps only jobs signed this calendar month", () => {
  assert.equal(chipMatches(card({ signedAt: "2026-09-02T10:00:00Z" }), "NewMonth", NOW), true);
  assert.equal(chipMatches(card({ signedAt: "2026-08-31T10:00:00Z" }), "NewMonth", NOW), false);
  assert.equal(chipMatches(card({ signedAt: "2025-09-10T10:00:00Z" }), "NewMonth", NOW), false);
  assert.equal(chipMatches(card({ signedAt: null }), "NewMonth", NOW), false);
});

test("a cancelled contract is never new business, same as the chip's count", () => {
  assert.equal(
    chipMatches(card({ signedAt: "2026-09-02T10:00:00Z", status: "cancelled" }), "NewMonth", NOW),
    false
  );
});

test("projectTotals sums the money columns of exactly the cards it is given", () => {
  const money = (over: Record<string, number>) =>
    card({
      rollup: {
        soldCents: 0,
        collectedCents: 0,
        costCents: 0,
        receivableCents: 0,
        netCashCents: 0,
        ...over,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unpaidBillsCents: 100 as any,
    });
  const totals = projectTotals([
    money({
      soldCents: 1000,
      collectedCents: 400,
      costCents: 50,
      receivableCents: 600,
      // Net as the rollup computes it: collected − cost − commission.
      commissionCents: 75,
      netCashCents: 275,
    }),
    // An unmeasured job's commission is null and must sum as zero, not
    // poison the total into NaN.
    money({ soldCents: 200, collectedCents: 200, netCashCents: 200 }),
  ]);
  assert.deepEqual(totals, {
    sold: 1200,
    collected: 600,
    cost: 50,
    receivable: 600,
    net: 475,
    unpaid: 200,
    commission: 75,
  });
  // The point of taking a list: hand it the filtered rows and the cards
  // speak for the filter, not the company.
  assert.deepEqual(projectTotals([]), {
    sold: 0,
    collected: 0,
    cost: 0,
    receivable: 0,
    net: 0,
    unpaid: 0,
    commission: 0,
  });
});

test("the Bleeding chip fires on the accrual figure: unpaid bills count, before the cash leaves", () => {
  const cashFineBillsNot = card({
    rollup: { netCashCents: 100_000, receivableCents: 0 } as never,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unpaidBillsCents: 700_000 as any,
  });
  assert.equal(chipMatches(cashFineBillsNot, "Bleeding", NOW), true);
  const healthy = card({
    rollup: { netCashCents: 100_000, receivableCents: 0 } as never,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unpaidBillsCents: 0 as any,
  });
  assert.equal(chipMatches(healthy, "Bleeding", NOW), false);
});

test("a focus id keeps exactly the one project the link named", () => {
  const target = card({ estimateId: "est-1" });
  const other = card({ estimateId: "est-2" });
  const noFilters = { search: "", client: "", rep: "", bounds: null };
  assert.equal(matchesProjectFilters(target, { ...noFilters, focusId: "est-1" }), true);
  assert.equal(matchesProjectFilters(other, { ...noFilters, focusId: "est-1" }), false);
  // No focus in the URL: nothing changes.
  assert.equal(matchesProjectFilters(other, noFilters), true);
});

test("New this month is the company's month, evenings included", () => {
  // Sep 30 in Los Angeles: the month runs from Sep 1 07:00 UTC to Oct 1 07:00 UTC.
  const la = projectClock("2026-09-30", "America/Los_Angeles");
  // Sep 30 at 7pm there -- UTC already called it October.
  assert.equal(chipMatches(card({ signedAt: "2026-10-01T02:00:00Z" }), "NewMonth", la), true);
  // Aug 31 at 10pm there -- UTC already called it September.
  assert.equal(chipMatches(card({ signedAt: "2026-09-01T05:00:00Z" }), "NewMonth", la), false);
  // Oct 1 at 12:30am there is next month's.
  assert.equal(chipMatches(card({ signedAt: "2026-10-01T07:30:00Z" }), "NewMonth", la), false);
});

const signedIn = (signedAt: string, bounds: [number, number] | null) =>
  matchesProjectFilters(card({ signedAt }), { search: "", client: "", rep: "", bounds });

test("a custom Signed range runs between the company's midnights", () => {
  const oct = dateRangeBounds("custom", "2026-10-01", "2026-10-08", "America/Los_Angeles");
  // Oct 8 at 6pm in Los Angeles is the range's last evening, in it.
  assert.equal(signedIn("2026-10-09T01:00:00Z", oct), true);
  // Sep 30 at 6pm there is the evening before it starts, out of it.
  assert.equal(signedIn("2026-10-01T01:00:00Z", oct), false);
  // Its first minute and its last are both in.
  assert.equal(signedIn("2026-10-01T07:00:00Z", oct), true);
  assert.equal(signedIn("2026-10-09T06:59:59Z", oct), true);
  assert.equal(signedIn("2026-10-09T07:00:00Z", oct), false);
});

test("either edge of a custom range may be left open, and a half-typed date is no edge", () => {
  const since = dateRangeBounds("custom", "2026-10-01", "", "America/Los_Angeles");
  assert.equal(signedIn("2030-01-01T00:00:00Z", since), true);
  assert.equal(signedIn("2026-10-01T01:00:00Z", since), false);
  const upTo = dateRangeBounds("custom", "", "2026-10-08", "America/Los_Angeles");
  assert.equal(signedIn("2020-01-01T00:00:00Z", upTo), true);
  assert.equal(signedIn("2026-10-09T07:00:00Z", upTo), false);
  // A date the address carries badly is no edge rather than a broken range.
  assert.equal(dateRangeBounds("custom", "2026-1", "nope", "America/Los_Angeles"), null);
  assert.equal(dateRangeBounds("custom", "", "", "America/Los_Angeles"), null);
});
