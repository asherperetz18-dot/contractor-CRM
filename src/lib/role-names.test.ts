import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_ROLES } from "./data/types.ts";
import {
  FIXED_ROLES,
  RENAMEABLE_ROLES,
  STANDARD_ROLE_NAMES,
  readRoleNames,
  roleName,
  roleNameProblem,
  roleNamesList,
  storedRoleNames,
} from "./role-names.ts";

test("every role reads as itself until a company renames it", () => {
  for (const role of APP_ROLES) assert.equal(STANDARD_ROLE_NAMES[role], role);
  assert.deepEqual(readRoleNames({}), STANDARD_ROLE_NAMES);
  assert.deepEqual(readRoleNames(null), STANDARD_ROLE_NAMES);
  assert.deepEqual(readRoleNames("not an object"), STANDARD_ROLE_NAMES);
  assert.equal(roleName(null, "Call Center"), "Call Center");
});

test("Admin and Office keep their names; the other six can be renamed", () => {
  // The app's messages say "Office or Admin" everywhere; renamed, they'd disagree with the screen.
  assert.deepEqual([...FIXED_ROLES], ["Admin", "Office"]);
  assert.deepEqual(
    [...RENAMEABLE_ROLES].sort(),
    APP_ROLES.filter((r) => r !== "Admin" && r !== "Office").sort()
  );
  // A stored name for either (edited by hand) is ignored.
  assert.equal(readRoleNames({ Admin: "Owner", Office: "Front Office" }).Admin, "Admin");
  assert.equal(readRoleNames({ Office: "Front Office" }).Office, "Office");
  assert.deepEqual(storedRoleNames({ Admin: "Owner", Office: "Front Office" }), { names: {} });
});

test("a saved name shows; a broken one falls back to the standard name", () => {
  const names = readRoleNames({ Sales: "Technicians", "Call Center": " Front Desk ", Field: "", Dispatch: "<b>x</b>" });
  assert.equal(names.Sales, "Technicians");
  assert.equal(names["Call Center"], "Front Desk");
  assert.equal(names.Field, "Field");
  assert.equal(names.Dispatch, "Dispatch");
  assert.equal(roleNamesList(names, ["Office", "Sales"]), "Office, Technicians");
});

test("a save stores only what changed, trimmed", () => {
  assert.deepEqual(
    storedRoleNames({ Sales: " Technicians ", Field: "Field", Office: "Office" }),
    { names: { Sales: "Technicians" } }
  );
});

test("names must be plain, short and present", () => {
  assert.equal(roleNameProblem("Front Desk"), null);
  assert.equal(roleNameProblem("Sales & Service"), null);
  assert.match(roleNameProblem("") ?? "", /Type a name/);
  assert.match(roleNameProblem("x".repeat(31)) ?? "", /30 characters/);
  assert.match(roleNameProblem("Crew 🚧") ?? "", /letters, numbers/);
  assert.match(roleNameProblem("<script>") ?? "", /letters, numbers/);
  assert.deepEqual(storedRoleNames({ Sales: "Crew 🚧" }), {
    error: "Sales: use letters, numbers, spaces, hyphens, apostrophes or &.",
  });
  // Left blank, a role goes back to its standard name.
  assert.deepEqual(storedRoleNames({ Sales: "  ", Field: "" }), { names: {} });
});

test("two roles can never read the same, so people can always tell them apart", () => {
  // Renaming Sales to "Field" while Field is still Field is refused, case-blind.
  assert.deepEqual(storedRoleNames({ Sales: "field" }), { error: 'Two roles can\'t both be called "Field".' });
  assert.deepEqual(storedRoleNames({ Sales: "Crew", Production: "Crew" }), {
    error: 'Two roles can\'t both be called "Crew".',
  });
  // Nor can a role take Admin's or Office's name.
  assert.match(JSON.stringify(storedRoleNames({ Field: "admin" })), /can't both be called/);
  assert.match(JSON.stringify(storedRoleNames({ Field: "Office" })), /can't both be called/);
  // Swapping names around is fine as long as they end up different.
  assert.deepEqual(storedRoleNames({ Sales: "Field", Field: "Crew" }), {
    names: { Sales: "Field", Field: "Crew" },
  });
  // A clash stored by hand reads as the standard names, never as two identical labels.
  assert.deepEqual(readRoleNames({ Sales: "Crew", Field: "Crew" }), STANDARD_ROLE_NAMES);
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("only Office and Admin can rename roles, and a save writes only the names -- never anyone's roles", () => {
  const actions = source("./actions/settings.ts");
  const fn = actions.slice(actions.indexOf("export async function saveRoleNames"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.ok(body.indexOf("isAdminRole(profile)") > 0);
  assert.ok(body.indexOf("isAdminRole(profile)") < body.indexOf(".update("));
  assert.match(body, /\.from\("company_profile"\)\s*\.update\(\{ role_names: parsed\.names \}\)/);
  assert.doesNotMatch(body, /company_members|role_page_visibility/);
});

test("screens show the company's name for a role but still act on the role itself", () => {
  const users = source("../app/(app)/settings/users-roles/users-roles-table.tsx");
  // The chip reads the name; the toggle still grants the role.
  assert.match(users, /<Badge[^>]*>\s*\{roleName\(roleNames, role\)\}/);
  assert.match(users, /handleToggleRole\(u, role\)/);
  assert.doesNotMatch(users, /<Badge[^>]*>\s*\{role\}/);
  const visibility = source("../app/(app)/settings/role-visibility/role-visibility-table.tsx");
  assert.match(visibility, /<span>\{roleName\(roleNames, role\)\}<\/span>/);
  assert.match(visibility, /setCell\(role, page\.key/);
  const clock = source("../app/(app)/settings/time-clock/settings-form.tsx");
  assert.equal((clock.match(/\{roleName\(roleNames, r\)\}/g) ?? []).length, 2);
  const grid = source("../app/(app)/salespeople/salespeople-grid.tsx");
  assert.match(grid, /\{roleName\(roleNames, r\)\}/);
  // Who counts as a salesperson is still the Sales role, whatever it is called.
  assert.match(grid, /r\.roles\.includes\("Sales"\)/);
});

test("a database without 0202 shows the standard names instead of failing", () => {
  const chrome = source("./data/company-chrome.ts");
  const fn = chrome.slice(chrome.indexOf("export function getRoleNamesCached"));
  assert.match(fn.slice(0, fn.indexOf("\n}\n")), /error \? STANDARD_ROLE_NAMES : readRoleNames/);
});
