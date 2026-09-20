import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RECENTS_CAP,
  pushRecent,
  recentId,
  resolveRecents,
} from "./settings-recents.ts";
import type { SettingsSectionDef } from "./data/settings-catalog.ts";

/**
 * The recents row on the Settings grid is remembered as a list of ids in
 * this browser. These tests pin the two boundaries that matter: what a
 * click may record (only cards that actually open something), and what a
 * stored id may show back (nothing the grid itself wouldn't show — a
 * card that was renamed away, or one the viewer's role can't see).
 */

const SECTIONS: SettingsSectionDef[] = [
  {
    category: "Company Identity",
    hint: "",
    cards: [
      { title: "Company Profile", desc: "", icon: "🏢", href: "/settings/company-profile" },
      { title: "Logo", desc: "", icon: "🖼", key: "logo" },
      // A "SOON" placeholder: no page, no modal worth returning to.
      { title: "Appearance & Theme", desc: "", icon: "🎨" },
    ],
  },
  {
    category: "People & Access",
    hint: "",
    cards: [
      { title: "Users & Roles", desc: "", icon: "👥", href: "/settings/users-roles" },
      { title: "Certificates", desc: "", icon: "📜", href: "/settings/certificates", adminOnly: true },
    ],
  },
];

test("a card is remembered by its route, the logo modal by its key, a SOON card not at all", () => {
  assert.equal(recentId({ href: "/settings/users-roles" }), "/settings/users-roles");
  assert.equal(recentId({ key: "logo" }), "logo");
  assert.equal(recentId({}), null);
});

test("last click sits first; clicking again moves it forward instead of duplicating", () => {
  let list: string[] = [];
  list = pushRecent(list, "/settings/users-roles");
  list = pushRecent(list, "logo");
  assert.deepEqual(list, ["logo", "/settings/users-roles"]);
  list = pushRecent(list, "/settings/users-roles");
  assert.deepEqual(list, ["/settings/users-roles", "logo"]);
});

test("the row holds the cap and forgets the oldest beyond it", () => {
  let list: string[] = [];
  for (let i = 0; i < RECENTS_CAP + 3; i++) list = pushRecent(list, `/settings/page-${i}`);
  assert.equal(list.length, RECENTS_CAP);
  assert.equal(list[0], `/settings/page-${RECENTS_CAP + 2}`);
  // The first three clicks have fallen off the end.
  assert.ok(!list.includes("/settings/page-0"));
});

test("stored ids resolve to live cards in click order; unknown ids vanish", () => {
  const cards = resolveRecents(
    ["logo", "/settings/removed-page", "/settings/company-profile"],
    SECTIONS,
    false
  );
  assert.deepEqual(cards.map((c) => c.title), ["Logo", "Company Profile"]);
});

test("an admin-only card drops out of the row for a non-admin, and stays for an admin", () => {
  const stored = ["/settings/certificates", "/settings/users-roles"];
  assert.deepEqual(
    resolveRecents(stored, SECTIONS, false).map((c) => c.title),
    ["Users & Roles"]
  );
  assert.deepEqual(
    resolveRecents(stored, SECTIONS, true).map((c) => c.title),
    ["Certificates", "Users & Roles"]
  );
});
