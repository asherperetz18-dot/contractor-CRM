import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTabActive,
  mobileTabs,
  moreSections,
  navHrefs,
  pageIcon,
  FALLBACK_PAGE_ICON,
} from "./mobile-tabs.ts";
import {
  GROUP_TONES,
  PAGE_REGISTRY,
  TOP_LEVEL_NAV_GROUP,
  type NavEntry,
  type NavGroupItem,
} from "./data/types.ts";

// The full menu, shaped the way lib/nav.ts builds it from the registry
// (that file's imports don't resolve under node --test).
function registryNav(): NavEntry[] {
  const nav: NavEntry[] = [];
  let group: NavGroupItem | null = null;
  for (const p of PAGE_REGISTRY) {
    if (p.group === TOP_LEVEL_NAV_GROUP) {
      group = null;
      nav.push({ type: "link", href: p.href, label: p.label, icon: "" });
      continue;
    }
    if (!group || group.label !== p.group) {
      group = { type: "group", label: p.group, icon: "", tone: GROUP_TONES[p.group], items: [] };
      nav.push(group);
    }
    group.items.push({ label: p.label, href: p.href });
  }
  return nav;
}
const NAV = registryNav();
const EVERYTHING = navHrefs(NAV);

test("office and sales get Home, Pipeline, Schedule and Jobs, in that order", () => {
  assert.deepEqual(
    mobileTabs(EVERYTHING, false).map((t) => [t.label, t.href]),
    [
      ["Home", "/"],
      ["Pipeline", "/pipeline"],
      ["Schedule", "/schedule"],
      ["Jobs", "/production"],
    ]
  );
});

test("a page the person cannot open is never a tab; the next useful page takes its seat", () => {
  const noBoardNoPipeline = EVERYTHING.filter((h) => h !== "/production" && h !== "/pipeline");
  assert.deepEqual(
    mobileTabs(noBoardNoPipeline, false).map((t) => t.href),
    ["/", "/schedule", "/estimates", "/contacts"]
  );
});

test("the field crew opens on Today (the clock and today's schedule), then their jobs", () => {
  const crew = ["/projects", "/schedule", "/time-clock", "/calendar"];
  assert.deepEqual(
    mobileTabs(crew, true).map((t) => [t.label, t.href]),
    [
      ["Today", "/time-clock"],
      ["Jobs", "/projects"],
      ["Schedule", "/schedule"],
      ["Calendar", "/calendar"],
    ]
  );
});

test("never more than four tabs (More is the fifth), fewer when fewer pages are open", () => {
  assert.equal(mobileTabs(EVERYTHING, false).length, 4);
  assert.equal(mobileTabs(EVERYTHING, true).length, 4);
  assert.deepEqual(mobileTabs(["/projects"], true).map((t) => t.href), ["/projects"]);
  assert.deepEqual(mobileTabs(["/projects", "/time-clock"], true).map((t) => t.label), ["Today", "Jobs"]);
  assert.deepEqual(mobileTabs([], false), []);
});

test("every tab has an icon and a color, and no page appears twice", () => {
  for (const crew of [false, true]) {
    const tabs = mobileTabs(EVERYTHING, crew);
    assert.equal(new Set(tabs.map((t) => t.href)).size, tabs.length);
    for (const t of tabs) {
      assert.ok(t.icon, `${t.label} has an icon`);
      assert.ok(t.tone, `${t.label} has a color`);
    }
  }
});

test("a tab lights up on its own page and the pages under it, and nowhere else", () => {
  assert.equal(isTabActive("/", "/"), true);
  assert.equal(isTabActive("/pipeline", "/"), false);
  assert.equal(isTabActive("/pipeline", "/pipeline"), true);
  assert.equal(isTabActive("/pipeline/abc-123", "/pipeline"), true);
  assert.equal(isTabActive("/pipelines", "/pipeline"), false);
  assert.equal(isTabActive("/projects/9", "/projects"), true);
});

test("navHrefs lists every page in the menu, grouped or not", () => {
  const hrefs = navHrefs([
    { type: "link", href: "/", label: "Dashboard", icon: "◎" },
    { type: "group", label: "Dispatch", icon: "▸", tone: "dispatch", items: [{ label: "Tasks", href: "/tasks" }] },
  ]);
  assert.deepEqual(hrefs, ["/", "/tasks"]);
});

test("More groups the menu into colored sections: loose pages first, then each department", () => {
  const sections = moreSections(NAV);
  assert.equal(sections[0].label, "Main");
  assert.equal(sections[0].tone, "home");
  assert.ok(sections[0].items.some((i) => i.href === "/"));
  const dispatch = sections.find((s) => s.label === "Dispatch");
  assert.equal(dispatch?.tone, "dispatch");
  assert.ok(dispatch?.items.some((i) => i.href === "/pipeline"));
  // Order follows the menu the person has, so a rearranged menu is
  // rearranged here too.
  const labels = sections.map((s) => s.label);
  assert.deepEqual(labels, ["Main", ...NAV.filter((e) => e.type === "group").map((e) => e.label)]);
});

test("More leaves out a department with nothing the person can open", () => {
  const sections = moreSections([{ type: "link", href: "/", label: "Dashboard", icon: "◎" }]);
  assert.deepEqual(sections.map((s) => s.label), ["Main"]);
});

test("every page in the menu has its own icon, so none shows the placeholder", () => {
  const hrefs = [...PAGE_REGISTRY.map((p) => p.href), "/settings", "/estimate-approvals"];
  for (const href of hrefs) {
    assert.notEqual(pageIcon(href), FALLBACK_PAGE_ICON, `${href} has no icon`);
  }
});
