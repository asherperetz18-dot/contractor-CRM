import { test } from "node:test";
import assert from "node:assert/strict";
import { portalFavicon } from "./favicon.ts";

/**
 * The portal's browser tab showed the product's own AI Build Pros mark
 * while the page itself showed the contractor's logo -- the customer is
 * the contractor's, so the tab should be too, the same way the staff app
 * already does it.
 */

test("a company logo becomes the tab icon", () => {
  assert.deepEqual(portalFavicon("https://cdn.example.com/logo.png"), {
    icons: { icon: "https://cdn.example.com/logo.png" },
  });
});

test("no logo leaves the root layout's product mark in place", () => {
  assert.deepEqual(portalFavicon(null), {});
  assert.deepEqual(portalFavicon(undefined), {});
});

test("a blank logo field is no logo, not an empty icon link", () => {
  assert.deepEqual(portalFavicon(""), {});
  assert.deepEqual(portalFavicon("   "), {});
});
