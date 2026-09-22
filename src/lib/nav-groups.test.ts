import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGE_REGISTRY, TOP_LEVEL_NAV_GROUP } from "./data/types.ts";

/**
 * The registry-to-sidebar contract. buildNav (lib/nav) opens a new
 * collapsible section every time the group label CHANGES between
 * consecutive registry entries -- so a group whose pages are scattered
 * through the array renders as two sections with the same name, not
 * one. Pinned here because moving a page into a group by editing only
 * its `group` field, without moving the entry next to the others, is
 * exactly the mistake that slips through a visual check.
 */
test("each sidebar group's registry entries are consecutive", () => {
  const seen = new Set<string>();
  let prev: string | null = null;
  for (const page of PAGE_REGISTRY) {
    // Top-level pages render as individual links, not a section, so
    // "General" may legitimately appear in several runs of the array.
    if (page.group === TOP_LEVEL_NAV_GROUP) {
      prev = null;
      continue;
    }
    if (page.group === prev) continue;
    assert.ok(
      !seen.has(page.group),
      `group "${page.group}" appears in two separate runs of the registry`
    );
    seen.add(page.group);
    prev = page.group;
  }
});

// Both commission screens live under Accounting: commission is money the
// company owes out, so it sits with Bills, Collect and Payments rather
// than as two loose links at the bottom of the menu.
test("both commission pages sit in the Accounting group", () => {
  for (const key of ["commissions", "sales-commission"] as const) {
    const page = PAGE_REGISTRY.find((p) => p.key === key);
    assert.ok(page, key + " is registered");
    assert.equal(page.group, "Accounting", key + " grouped under Accounting");
    assert.notEqual(page.group, TOP_LEVEL_NAV_GROUP);
  }
});

// Salespeople is the selling leaderboard -- reps ranked by won value --
// so it sits in its own people group (Staff), NOT with the dialer and
// its call/text reports (it reports on selling, not on calling), not
// under Accounting (nothing on it is a company dollar owed) and not in
// the middle of the Dispatch lead-operations list.
test("Salespeople sits in Staff", () => {
  const page = PAGE_REGISTRY.find((p) => p.key === "salespeople");
  assert.ok(page, "salespeople is registered");
  assert.equal(page.group, "Staff");
});

// The dialer and the activity reports are the Call Center: the group
// carries the same name as the Call Center role that lives in it, and
// the old "Your Sales Center" heading is gone from every page.
test("the dialer and its reports sit in Call Center, and nothing says Sales Center", () => {
  for (const key of ["power-dialer", "call-reports", "text-reports", "appointment-reports"] as const) {
    const page = PAGE_REGISTRY.find((p) => p.key === key);
    assert.ok(page, key + " is registered");
    assert.equal(page.group, "Call Center", key + " grouped under Call Center");
  }
  for (const page of PAGE_REGISTRY) {
    assert.ok(!/sales center/i.test(page.group), page.key + " still says Sales Center");
  }
});
