import { test } from "node:test";
import assert from "node:assert/strict";
import { saleCredits, splitCents } from "./sale-credit.ts";

/**
 * Who a signed contract counts for. The Sales team seats on the
 * contract (sales_rep_1/2 with their shares) are the office's own
 * statement of who sold it -- seeded from the lead at signature and
 * corrected on the panel -- and they are what commission is paid on. A
 * page that credited the rep stamped on the document at creation put a
 * $8,000 sale on the second-chair rep while the seats said 100% Frank.
 */

const doc = (over: Record<string, unknown>) => ({
  assigned_to: "stamped",
  sales_rep_1: null,
  sales_rep_1_bp: null,
  sales_rep_2: null,
  sales_rep_2_bp: null,
  ...over,
});

test("the salesperson seat gets the sale; a zero-share second seat gets nothing", () => {
  assert.deepEqual(
    saleCredits(doc({ assigned_to: "simon", sales_rep_1: "frank", sales_rep_1_bp: 10000, sales_rep_2: "simon", sales_rep_2_bp: 0 })),
    [{ rep: "frank", bp: 10000 }]
  );
});

test("a partnership splits by share, both seats credited", () => {
  assert.deepEqual(
    saleCredits(doc({ sales_rep_1: "a", sales_rep_1_bp: 6000, sales_rep_2: "b", sales_rep_2_bp: 4000 })),
    [
      { rep: "a", bp: 6000 },
      { rep: "b", bp: 4000 },
    ]
  );
});

test("no seats yet: the rep stamped on the document, whole", () => {
  assert.deepEqual(saleCredits(doc({})), [{ rep: "stamped", bp: 10000 }]);
  assert.deepEqual(saleCredits(doc({ assigned_to: null })), []);
});

test("a seat with no share recorded still counts as the whole sale", () => {
  // Pre-0135 contracts carry a rep in seat one and no split at all.
  assert.deepEqual(saleCredits(doc({ sales_rep_1: "old", sales_rep_1_bp: null })), [{ rep: "old", bp: 10000 }]);
});

test("the closer never takes the sale", () => {
  assert.deepEqual(
    saleCredits(doc({ sales_rep_1: "frank", sales_rep_1_bp: 10000, closer_id: "simon", closer_pool_bp: 2000 })),
    [{ rep: "frank", bp: 10000 }]
  );
});

test("splitCents: shares of the total that add back up to it", () => {
  assert.equal(splitCents(800000, 10000), 800000);
  assert.equal(splitCents(1000001, 5000) + splitCents(1000001, 5000), 1000002);
  assert.equal(splitCents(100, 3333), 33);
});
