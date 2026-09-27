import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Google Play requires an app to sell its own subscription through Play
 * Billing, and not to steer people to another way to pay (DECISIONS #087).
 * The phone app opens the live CRM, so every screen that signs a company
 * up for, renews, or manages the AI Build Pro subscription must hide
 * that inside the app: it wraps it in <WebOnly>.
 *
 * This test reads the pages and components and fails on any file that
 * links to signup or calls a subscription action without WebOnly.
 * Payments a homeowner makes to a contractor are for real-world work,
 * which Play allows; they are not listed here.
 */

const srcRoot = join(import.meta.dirname, "..", "..");
const ROOTS = ["app", "components"].map((d) => join(srcRoot, d));

// Signup's own pages are the website's; the app never links to them.
const EXEMPT = [/^app\/get-started\//, /^app\/welcome\//, /^app\/register\//];

const SELLS = [
  /href=["{]["`]?\/get-started/,
  /\brenewSubscription\b/,
  /\bopenBillingPortal\b/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

test("every screen that sells or manages the subscription hides it in the phone app", () => {
  const offenders: string[] = [];
  for (const file of ROOTS.flatMap((r) => walk(r))) {
    const rel = relative(srcRoot, file).split("\\").join("/");
    if (EXEMPT.some((re) => re.test(rel))) continue;
    const src = readFileSync(file, "utf8");
    if (SELLS.some((re) => re.test(src)) && !src.includes("<WebOnly")) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test("the guard sees the screens it is meant to guard", () => {
  // If these move or are renamed, the guard above would pass by finding
  // nothing; this keeps it honest.
  const seen = ROOTS.flatMap((r) => walk(r))
    .map((f) => relative(srcRoot, f).split("\\").join("/"))
    .filter((rel) => SELLS.some((re) => re.test(readFileSync(join(srcRoot, rel), "utf8"))));
  for (const want of [
    "app/login/login-form.tsx",
    "app/billing-locked/billing-lock-actions.tsx",
    "app/(app)/settings/billing/manage-billing-button.tsx",
  ]) {
    assert.ok(seen.includes(want), `${want} no longer matched`);
  }
});
