import { test } from "node:test";
import assert from "node:assert/strict";
import { receiptPathBelongs, receiptUploadPath } from "./receipts.ts";

/**
 * The path is the whole of the tenant check on the shared receipts
 * bucket: a bill or cost may only be pointed at a slot issued for its
 * own job (or its own company's overhead). So the edges are tested.
 */

const CO = "11111111-1111-1111-1111-111111111111";
const JOB = "22222222-2222-2222-2222-222222222222";
const OTHER_JOB = "33333333-3333-3333-3333-333333333333";

test("a job's slot lives under its lead; overhead lives under the company", () => {
  assert.match(receiptUploadPath(CO, JOB, "inv.pdf"), new RegExp(`^receipts/${JOB}/\\d+-inv\\.pdf$`));
  assert.match(receiptUploadPath(CO, null, "fuel.jpg"), new RegExp(`^receipts/_company/${CO}/\\d+-fuel\\.jpg$`));
});

test("slashes in the file name are flattened, so it can't climb out of its folder", () => {
  const p = receiptUploadPath(CO, JOB, "../../etc/passwd");
  // Always exactly receipts / <job> / <file>, whatever the name held.
  assert.equal(p.split("/").length, 3);
  assert.equal(p.split("/")[1], JOB);
  assert.equal(receiptPathBelongs(p, CO, JOB), true);
});

test("a job's path belongs to that job and nothing else", () => {
  const p = receiptUploadPath(CO, JOB, "a.jpg");
  assert.equal(receiptPathBelongs(p, CO, JOB), true);
  assert.equal(receiptPathBelongs(p, CO, OTHER_JOB), false);
  // A job file may not be filed as overhead, and overhead may not be
  // filed onto a job -- either would cross the line the path draws.
  assert.equal(receiptPathBelongs(p, CO, null), false);
  const o = receiptUploadPath(CO, null, "a.jpg");
  assert.equal(receiptPathBelongs(o, CO, null), true);
  assert.equal(receiptPathBelongs(o, CO, JOB), false);
  assert.equal(receiptPathBelongs(o, "44444444-4444-4444-4444-444444444444", null), false);
});
