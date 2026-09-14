import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IMPORT_CHUNK_ROWS,
  chunkRows,
  collectContactKeys,
  matchDuplicateIndexes,
} from "./import-batching.ts";

/**
 * A 73k-row spreadsheet froze the import: the whole file went up as one
 * server-action request (past Vercel's request-body cap) and the
 * duplicate scan compared against only the first 1000 existing contacts
 * (PostgREST's silent page limit). These helpers are the pure core of
 * the fix -- slicing the upload into requests that fit, and doing the
 * duplicate matching in the browser against a downloaded key set.
 */

test("chunkRows slices in order and keeps every row exactly once", () => {
  assert.deepEqual(chunkRows([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkRows([1, 2], 2), [[1, 2]]);
  assert.deepEqual(chunkRows([], 2), []);
  // The default chunk must stay comfortably inside Vercel's 4.5MB
  // serverless request-body cap at ~0.5KB per mapped row.
  assert.ok(IMPORT_CHUNK_ROWS * 500 < 4_000_000);
});

test("collectContactKeys normalises every phone slot and lowercases emails", () => {
  const keys = collectContactKeys([
    {
      phone: "(714) 235-6145",
      phone2: null,
      phone3: "+1 310-882-1451",
      email: "Angie.H@Gmail.com ",
      second_contact_phone: "949.364.0451",
    },
    { phone: null, phone2: "", phone3: null, email: null, second_contact_phone: null },
  ]);
  assert.deepEqual([...keys.phones].sort(), ["3108821451", "7142356145", "9493640451"]);
  assert.deepEqual(keys.emails, ["angie.h@gmail.com"]);
  // Blank slots must not collect an empty key that would then "match"
  // every row with a blank phone or email.
  assert.ok(!keys.phones.includes(""));
  assert.ok(!keys.emails.includes(""));
});

test("matchDuplicateIndexes matches through formatting, any phone slot, and email case", () => {
  const existing = collectContactKeys([
    { phone: "7142356145", phone2: null, phone3: null, email: "known@x.com", second_contact_phone: "5626903785" },
  ]);
  const rows = [
    { phone: "(714) 235-6145", email: "" }, // same digits, different formatting
    { phone: "", phone2: "", phone3: "562-690-3785", email: "" }, // second-contact phone, third slot
    { phone: "", email: "KNOWN@X.COM" }, // email, case-insensitive
    { phone: "3235561789", email: "new@x.com" }, // genuinely new
    { phone: "", email: "" }, // blank row never matches blank keys
  ];
  assert.deepEqual(matchDuplicateIndexes(rows, existing), [0, 1, 2]);
});
