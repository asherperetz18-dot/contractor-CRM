import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The company switcher's "+ New company" was open to any Office or Admin
 * user, made as many companies as they liked -- none of them billed --
 * and copied the current company's stages, lead sources and the rest
 * into each. It is now a platform admin's tool, and a new company starts
 * from the standard starter lists (DECISIONS #119).
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("only a platform admin can create a company from the switcher", () => {
  const action = read("./actions/company.ts");
  const start = action.indexOf("export async function createCompany(");
  const fn = action.slice(start, action.indexOf("\n}\n", start));
  assert.match(fn, /isPlatformAdmin\(profile\)/);
  assert.doesNotMatch(fn, /isAdminRole\(/);
  const layout = read("../app/(app)/layout.tsx");
  assert.match(layout, /canCreate=\{isPlatformAdmin\(profile\)\}/);
});

test("a new company starts clean, not as a copy of the current one", () => {
  const action = read("./actions/company.ts");
  const start = action.indexOf("export async function createCompany(");
  const fn = action.slice(start, action.indexOf("\n}\n", start));
  assert.doesNotMatch(fn, /sourceCompanyId/);
});
