import { test } from "node:test";
import assert from "node:assert/strict";
import { navEntryKey, sortNavEntries, type NavEntry } from "./data/types.ts";

// A miniature of the real menu shape: links, groups, Settings last.
const NAV: NavEntry[] = [
  { type: "link", href: "/", label: "Dashboard", icon: "o" },
  { type: "link", href: "/marketing-analytics", label: "Marketing Analytics", icon: "o" },
  { type: "group", label: "Dispatch (Leads Mgmt.)", icon: "o", items: [{ label: "Pipeline", href: "/pipeline" }] },
  { type: "group", label: "Your Sales Center", icon: "o", items: [{ label: "Dialer", href: "/dial-queue" }] },
  { type: "link", href: "/projects", label: "Projects", icon: "o" },
  { type: "link", href: "/settings", label: "Admin Settings", icon: "o" },
];

/**
 * The saved-order rules the Menu Order screen relies on. The sidebar is
 * rebuilt from PAGE_REGISTRY on every deploy, so what must hold is not
 * a specific menu but the contract: saved entries in saved order, new
 * entries appended rather than lost, Admin Settings immovable.
 */

const keys = NAV.map(navEntryKey);

test("empty or missing order leaves the built-in menu untouched", () => {
  assert.deepEqual(sortNavEntries(NAV, []), NAV);
  assert.deepEqual(sortNavEntries(NAV, null), NAV);
});

test("a saved order is applied to the entries it names", () => {
  const reversed = [...keys].filter((k) => k !== "/settings").reverse();
  const sorted = sortNavEntries(NAV, reversed).map(navEntryKey);
  assert.deepEqual(sorted.slice(0, reversed.length), reversed);
});

test("entries the saved order does not know are appended, not lost", () => {
  // An order saved before some feature shipped: it only names two keys.
  const partial = [keys[2], keys[0]];
  const sorted = sortNavEntries(NAV, partial).map(navEntryKey);
  assert.deepEqual(sorted.slice(0, 2), partial);
  assert.equal(sorted.length, NAV.length);
  for (const k of keys) assert.ok(sorted.includes(k), k + " survived the sort");
});

test("Admin Settings stays pinned last even when the order names it first", () => {
  const sorted = sortNavEntries(NAV, ["/settings", keys[1]]).map(navEntryKey);
  assert.equal(sorted[sorted.length - 1], "/settings");
});

test("a group the saved order predates takes the spot its pages held", () => {
  // Projects and the board were top-level links when this order was
  // saved; the deploy since folded both into a Production dropdown.
  const regrouped: NavEntry[] = [
    NAV[0],
    NAV[1],
    {
      type: "group",
      label: "Production",
      icon: "o",
      items: [
        { label: "Production Board", href: "/production" },
        { label: "Projects", href: "/projects" },
      ],
    },
    NAV[5],
  ];
  const saved = ["/marketing-analytics", "/projects", "/", "/production"];
  const sorted = sortNavEntries(regrouped, saved).map(navEntryKey);
  // The group sits where Projects was -- above Dashboard, not at the end.
  assert.deepEqual(sorted, ["/marketing-analytics", "group:Production", "/", "/settings"]);
});
