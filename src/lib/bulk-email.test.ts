import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBulkEmailContent, resolveBulkEmailTargets } from "./bulk-email.ts";

test("resolveBulkEmailTargets keeps one target per lead with a usable email", () => {
  const { targets, skipped } = resolveBulkEmailTargets([
    { id: "1", email: "a@example.com" },
    { id: "2", email: "b@example.com" },
  ]);
  assert.deepEqual(targets, [
    { id: "1", email: "a@example.com" },
    { id: "2", email: "b@example.com" },
  ]);
  assert.equal(skipped, 0);
});

test("resolveBulkEmailTargets skips blank, whitespace-only, and missing emails", () => {
  const { targets, skipped } = resolveBulkEmailTargets([
    { id: "1", email: "a@example.com" },
    { id: "2", email: "" },
    { id: "3", email: "   " },
    { id: "4", email: null },
  ]);
  assert.deepEqual(targets, [{ id: "1", email: "a@example.com" }]);
  assert.equal(skipped, 3);
});

test("resolveBulkEmailTargets dedupes case-insensitively, keeping the first lead", () => {
  const { targets, skipped } = resolveBulkEmailTargets([
    { id: "1", email: "Same@Example.com" },
    { id: "2", email: "same@example.com" },
  ]);
  assert.deepEqual(targets, [{ id: "1", email: "Same@Example.com" }]);
  assert.equal(skipped, 1);
});

test("resolveBulkEmailTargets trims surrounding whitespace on a usable email", () => {
  const { targets } = resolveBulkEmailTargets([{ id: "1", email: "  a@example.com  " }]);
  assert.deepEqual(targets, [{ id: "1", email: "a@example.com" }]);
});

test("buildBulkEmailContent trims subject and keeps the raw message as text", () => {
  const { subject, text } = buildBulkEmailContent("  Hello there  ", "Line one\nLine two");
  assert.equal(subject, "Hello there");
  assert.equal(text, "Line one\nLine two");
});

test("buildBulkEmailContent escapes HTML and turns newlines into <br>", () => {
  const { html } = buildBulkEmailContent("Subject", "Hi <script>alert(1)</script>\nSecond line");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Hi[\s\S]*<br\s*\/?>[\s\S]*Second line/);
});
