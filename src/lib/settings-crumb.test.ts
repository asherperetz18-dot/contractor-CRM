import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isSettingsSubPage, settingsPageTitle } from "./settings-crumb.ts";
import { SETTINGS_SECTIONS, type SettingsSectionDef } from "./data/settings-catalog.ts";

/**
 * Every page under /settings/ shows a "⚙ Settings › Page" crumb back to
 * the grid, rendered once by the settings layout. These tests pin what
 * the layout decides: which routes get the crumb at all, and what name
 * it shows — the title of the tile the grid opened the page from.
 */

const SECTIONS: SettingsSectionDef[] = [
  {
    category: "Sales & Pipeline",
    hint: "",
    cards: [
      { title: "Pipeline Stages", desc: "", icon: "📍", href: "/settings/pipeline-stages" },
      { title: "Estimate Defaults", desc: "", icon: "📄" },
      {
        title: "Commission & Lead Cost Defaults",
        desc: "",
        icon: "%",
        href: "/settings/sales-commission",
      },
    ],
  },
  {
    category: "Email & Messaging",
    hint: "",
    cards: [
      // Two tiles open the same page.
      { title: "Email Sender Settings", desc: "", icon: "📨", href: "/settings/email" },
      { title: "Resend API Key", desc: "", icon: "🔑", href: "/settings/email" },
    ],
  },
];

test("every page under the grid gets the crumb; the grid itself does not", () => {
  assert.equal(isSettingsSubPage("/settings/sales-commission"), true);
  assert.equal(isSettingsSubPage("/settings/users-roles"), true);
  assert.equal(isSettingsSubPage("/settings"), false);
  assert.equal(isSettingsSubPage("/settings/"), false);
  // Only the settings tree, not a route that happens to share the prefix.
  assert.equal(isSettingsSubPage("/settings-export"), false);
  assert.equal(isSettingsSubPage("/contacts"), false);
});

test("the crumb names the page by the tile that opened it", () => {
  assert.equal(
    settingsPageTitle("/settings/sales-commission", SECTIONS),
    "Commission & Lead Cost Defaults"
  );
  assert.equal(settingsPageTitle("/settings/pipeline-stages", SECTIONS), "Pipeline Stages");
});

test("a page two tiles open takes the first tile's name", () => {
  assert.equal(settingsPageTitle("/settings/email", SECTIONS), "Email Sender Settings");
});

test("a route with no tile has no name, so the crumb is just the way back", () => {
  assert.equal(settingsPageTitle("/settings/nothing-here", SECTIONS), null);
  assert.equal(settingsPageTitle("/settings", SECTIONS), null);
});

test("every settings page that exists has a tile, so no crumb is ever blank", () => {
  // The route folders are the list of pages; the catalog must know each
  // one. A new settings page without a tile fails here rather than
  // shipping with an unnamed crumb (and unreachable from the grid).
  const root = join(import.meta.dirname, "..", "app", "(app)", "settings");
  const pages = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "page.tsx")))
    .map((d) => d.name);
  assert.ok(pages.length > 30, `expected the settings pages, found ${pages.length}`);
  const unnamed = pages.filter(
    (p) => settingsPageTitle(`/settings/${p}`, SETTINGS_SECTIONS) === null
  );
  assert.deepEqual(unnamed, []);
});
