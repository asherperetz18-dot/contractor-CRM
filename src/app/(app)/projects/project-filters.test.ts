import { test } from "node:test";
import assert from "node:assert/strict";
import { chipMatches, projectTotals } from "./project-filters.ts";
import type { ProjectCard } from "./projects-view";

/**
 * The "New this month" chip exists so the stat card of the same name is
 * clickable -- the card counts jobs signed this calendar month, and the
 * chip must select exactly those, or the card says 8 and the click
 * shows some other list.
 */

const card = (over: Partial<ProjectCard>): ProjectCard =>
  ({
    status: "in_progress",
    signedAt: null,
    rollup: { netCashCents: 0, receivableCents: 0 },
    ...over,
  }) as ProjectCard;

const NOW = new Date("2026-09-17T12:00:00");

test("NewMonth keeps only jobs signed this calendar month", () => {
  assert.equal(chipMatches(card({ signedAt: "2026-09-02T10:00:00Z" }), "NewMonth", NOW), true);
  assert.equal(chipMatches(card({ signedAt: "2026-08-31T10:00:00Z" }), "NewMonth", NOW), false);
  assert.equal(chipMatches(card({ signedAt: "2025-09-10T10:00:00Z" }), "NewMonth", NOW), false);
  assert.equal(chipMatches(card({ signedAt: null }), "NewMonth", NOW), false);
});

test("a cancelled contract is never new business, same as the card's count", () => {
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
