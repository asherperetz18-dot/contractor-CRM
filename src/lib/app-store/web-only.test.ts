import { test } from "node:test";
import assert from "node:assert/strict";
import { webOnlyView } from "./web-only.ts";

test("before the page knows where it runs, nothing shows -- so the app never flashes a sales link", () => {
  assert.equal(webOnlyView(null), "nothing");
});

test("a browser shows the content", () => {
  assert.equal(webOnlyView(false), "content");
});

test("the phone app shows the fallback instead", () => {
  assert.equal(webOnlyView(true), "fallback");
});
