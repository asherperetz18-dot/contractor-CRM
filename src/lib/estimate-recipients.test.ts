import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExtraRecipients } from "./estimate-recipients.ts";

test("splits on comma, semicolon, and newline, trimming each piece", () => {
  const { emails } = parseExtraRecipients("a@x.com, b@x.com;c@x.com\nd@x.com", []);
  assert.deepEqual(emails, ["a@x.com", "b@x.com", "c@x.com", "d@x.com"]);
});

test("drops blank entries from extra separators", () => {
  const { emails } = parseExtraRecipients("a@x.com,, ; \n b@x.com", []);
  assert.deepEqual(emails, ["a@x.com", "b@x.com"]);
});

test("rejects malformed addresses into invalid, not silently dropped", () => {
  const { emails, invalid } = parseExtraRecipients("a@x.com, not-an-email, b@x.com", []);
  assert.deepEqual(emails, ["a@x.com", "b@x.com"]);
  assert.deepEqual(invalid, ["not-an-email"]);
});

test("dedupes valid emails case-insensitively, keeping first spelling", () => {
  const { emails } = parseExtraRecipients("Same@Example.com, same@example.com", []);
  assert.deepEqual(emails, ["Same@Example.com"]);
});

test("drops any address matching the exclude list case-insensitively", () => {
  const { emails } = parseExtraRecipients("a@x.com, LEAD@x.com, b@x.com", ["lead@x.com", null, undefined]);
  assert.deepEqual(emails, ["a@x.com", "b@x.com"]);
});

test("empty input yields no emails and no invalid entries", () => {
  const { emails, invalid } = parseExtraRecipients("", []);
  assert.deepEqual(emails, []);
  assert.deepEqual(invalid, []);
});
