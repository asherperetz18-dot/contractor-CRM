import { test } from "node:test";
import assert from "node:assert/strict";
import { documentTitle, pageTitle, tabTitle } from "./tab-title.ts";

/**
 * The tab title is the PDF file name, so it has to be the document number
 * -- and it has to stay that way while the popup watcher badges and
 * un-badges the tab in the background.
 */

test("the document number is the title, so the PDF is named after it", () => {
  assert.equal(documentTitle("EST-1048"), "EST-1048");
  assert.equal(documentTitle("  EST-1048 "), "EST-1048");
});

test("a document with no number gets the fallback, never an empty tab", () => {
  assert.equal(documentTitle(null), "Estimate");
  assert.equal(documentTitle(undefined, "Your estimate"), "Your estimate");
  assert.equal(documentTitle("   ", "Your estimate"), "Your estimate");
});

test("characters no file system accepts are swapped, so the name saves as-is", () => {
  assert.equal(documentTitle('EST/1048:"a"?'), "EST-1048--a--");
});

test("the badge comes off, and only the badge", () => {
  assert.equal(pageTitle("(3) New alerts — EST-1048"), "EST-1048");
  assert.equal(pageTitle("EST-1048"), "EST-1048");
  // A page whose own title merely mentions alerts is left alone.
  assert.equal(pageTitle("New alerts — settings"), "New alerts — settings");
});

test("visible: the page's own title, badge or not", () => {
  assert.equal(tabTitle("EST-1048", false, 5), "EST-1048");
  assert.equal(tabTitle("(2) New alerts — EST-1048", false, 5), "EST-1048");
});

test("hidden with something waiting: badged once, never stacked", () => {
  const once = tabTitle("EST-1048", true, 2);
  assert.equal(once, "(2) New alerts — EST-1048");
  // The next poll starts from the badged title and must not compound it.
  assert.equal(tabTitle(once, true, 3), "(3) New alerts — EST-1048");
  // Nothing waiting: hidden or not, the badge is gone.
  assert.equal(tabTitle(once, true, 0), "EST-1048");
});
