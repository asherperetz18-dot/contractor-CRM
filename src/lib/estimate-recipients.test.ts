import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExtraRecipients, resolveEstimateRecipients } from "./estimate-recipients.ts";

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

test("resolveEstimateRecipients: base case is lead + second contact, no extras", () => {
  const r = resolveEstimateRecipients({
    leadEmail: "robert@example.com",
    secondContactEmail: "maria@example.com",
    toRaw: "",
    ccRaw: "",
    bccRaw: "",
  });
  assert.deepEqual(r.to, ["robert@example.com"]);
  assert.deepEqual(r.cc, ["maria@example.com"]);
  assert.deepEqual(r.bcc, []);
  assert.deepEqual(r.invalidTo, []);
  assert.deepEqual(r.invalidCc, []);
  assert.deepEqual(r.invalidBcc, []);
});

test("resolveEstimateRecipients: second contact equal to lead email collapses to one To", () => {
  const r = resolveEstimateRecipients({
    leadEmail: "robert@example.com",
    secondContactEmail: "Robert@Example.com",
    toRaw: "",
    ccRaw: "",
    bccRaw: "",
  });
  assert.deepEqual(r.to, ["robert@example.com"]);
  assert.deepEqual(r.cc, []);
});

test("resolveEstimateRecipients: extras append to their own bucket and cross-bucket dedupe", () => {
  const r = resolveEstimateRecipients({
    leadEmail: "robert@example.com",
    secondContactEmail: "maria@example.com",
    toRaw: "pm@example.com",
    ccRaw: "maria@example.com, super@example.com",
    bccRaw: "pm@example.com, office@example.com",
  });
  assert.deepEqual(r.to, ["robert@example.com", "pm@example.com"]);
  // maria@example.com already claimed by cc's base entry; pm@example.com already claimed by to.
  assert.deepEqual(r.cc, ["maria@example.com", "super@example.com"]);
  assert.deepEqual(r.bcc, ["office@example.com"]);
});

test("resolveEstimateRecipients: no lead email promotes the first Cc entry into To", () => {
  const r = resolveEstimateRecipients({
    leadEmail: null,
    secondContactEmail: null,
    toRaw: "",
    ccRaw: "pm@example.com, super@example.com",
    bccRaw: "",
  });
  assert.deepEqual(r.to, ["pm@example.com"]);
  assert.deepEqual(r.cc, ["super@example.com"]);
});

test("resolveEstimateRecipients: no lead email and no Cc promotes the first Bcc entry into To", () => {
  const r = resolveEstimateRecipients({
    leadEmail: null,
    secondContactEmail: null,
    toRaw: "",
    ccRaw: "",
    bccRaw: "office@example.com, super@example.com",
  });
  assert.deepEqual(r.to, ["office@example.com"]);
  assert.deepEqual(r.bcc, ["super@example.com"]);
});

test("resolveEstimateRecipients: malformed entries are reported per-bucket, not silently dropped", () => {
  const r = resolveEstimateRecipients({
    leadEmail: "robert@example.com",
    secondContactEmail: null,
    toRaw: "not-an-email",
    ccRaw: "also-bad",
    bccRaw: "still-bad",
  });
  assert.deepEqual(r.invalidTo, ["not-an-email"]);
  assert.deepEqual(r.invalidCc, ["also-bad"]);
  assert.deepEqual(r.invalidBcc, ["still-bad"]);
});
