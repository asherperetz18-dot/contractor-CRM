import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Reading QuickBooks' products and services for "Send invoices to
 * QuickBooks" (DECISIONS #184). Invoices can't be turned on until the
 * product or service for job work is picked, and that list is empty until
 * the CRM has read it, so the card says how to fill it, reads it on the
 * spot, and says why Save is greyed out.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const actions = () => source("../actions/quickbooks.ts");
const view = () => source("../../app/(app)/settings/quickbooks/quickbooks-view.tsx");

test("Refresh accounts says how many products and services it read, or why it couldn't", () => {
  const a = actions();
  assert.match(a, /Promise<\{ error\?: string; count\?: number; items\?: number; itemsError\?: string \}>/);
  assert.match(a, /itemsError: `Products and services couldn't be read from QuickBooks: \$\{items\.error\.message\}`/);
  assert.match(a, /return \{ count: read\.accounts\.length, items: items\.items\.length \};/);
  const v = view();
  assert.match(v, /and \$\{r\.items\} products and services/);
});

test("the invoices card reads products and services itself, and says what to do when there are none", () => {
  const v = view();
  assert.match(v, /function readProducts\(\)/);
  assert.match(v, /await refreshQuickBooksAccounts\(\)/);
  assert.match(v, /Read products and services/);
  // Read, but nothing an invoice line can be.
  assert.match(v, /has no active service or non-inventory products/);
  assert.doesNotMatch(v, /No products or services read from QuickBooks yet\. Click Refresh accounts above\./);
});

test("a greyed-out Save says what's missing", () => {
  const v = view();
  assert.match(v, /Pick the product or service for job work to turn this on\./);
  assert.match(v, /Pick the start date to turn this on\./);
});
