import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDuplicatePairs, type DupPairContact } from "./duplicate-pairs.ts";

/**
 * The merge tool used to expand every shared phone/email into pairwise
 * combinations of FULL lead rows -- one junk number shared by 500
 * imported contacts alone is 124,750 pairs, which froze the browser
 * ("Page Unresponsive") the day the 73k import landed. These tests pin
 * the old pairing semantics (>=7-digit phone keys, lowercase email,
 * dismissals, reason union, most-reasons-first) and the new safety
 * rails: an oversized group is reported as a cluster instead of
 * exploded into pairs, and the pair list is capped with an exact total.
 */

function c(id: string, phone: string | null, email: string | null): DupPairContact {
  return {
    id,
    contact_type: "Individual",
    company_name: null,
    first_name: id,
    last_name: null,
    phone,
    email,
    source: null,
    stage: "New",
    created_at: "2026-09-01T00:00:00Z",
  };
}

test("pairs keep the old semantics: 7+ digit phones, lowercase emails, reasons union, dismissals out", () => {
  const out = buildDuplicatePairs(
    [
      c("a", "697-6137", "sam@home.com"),   // 7-digit phone still pairs
      c("b", "6976137", "SAM@home.com "),   // same phone AND same email
      c("x", "555-0001", null),
      c("y", "5550001", null),              // dismissed below
    ],
    new Set(["x:y"]),
    { maxGroupSize: 8, maxPairs: 200 }
  );
  assert.equal(out.totalPairs, 1);
  assert.deepEqual(out.pairs[0].reasons.sort(), ["email", "phone"]);
  assert.deepEqual([out.pairs[0].leadA.id, out.pairs[0].leadB.id], ["a", "b"]);
  assert.deepEqual(out.oversized, []);
});

test("an oversized group becomes a cluster report, never a pair explosion", () => {
  const rows = Array.from({ length: 50 }, (_, i) => c(`m${String(i).padStart(2, "0")}`, "3100000000", null));
  rows.push(c("p", "5550001111", null), c("q", "5550001111", null));
  const out = buildDuplicatePairs(rows, new Set(), { maxGroupSize: 8, maxPairs: 200 });
  // The 50-strong junk number is not expanded (that would be 1,225 pairs).
  assert.deepEqual(out.oversized, [{ kind: "phone", key: "3100000000", count: 50 }]);
  assert.equal(out.totalPairs, 1);
  assert.deepEqual([out.pairs[0].leadA.id, out.pairs[0].leadB.id], ["p", "q"]);
});

test("the pair list is capped but the total stays exact, most-reasons-first", () => {
  const rows: DupPairContact[] = [];
  for (let i = 0; i < 5; i++) {
    rows.push(c(`a${i}`, `555000100${i}`, `pair${i}@x.com`));
    rows.push(c(`b${i}`, `555000100${i}`, `pair${i}@x.com`)); // two reasons each
  }
  rows.push(c("s1", "5559990000", null), c("s2", "5559990000", null)); // one reason
  const out = buildDuplicatePairs(rows, new Set(), { maxGroupSize: 8, maxPairs: 3 });
  assert.equal(out.totalPairs, 6);
  assert.equal(out.pairs.length, 3);
  // The capped window holds the strongest matches.
  for (const p of out.pairs) assert.equal(p.reasons.length, 2);
});
