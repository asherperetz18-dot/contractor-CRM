import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  estimateLender,
  lenderSettingsError,
  lendersFromProfile,
  lendersFromRows,
  nextLender,
  reorderLenders,
  usableLenders,
  type CompanyLender,
} from "./financing.ts";

/**
 * Several lenders (DECISIONS #170). A company can work with more than one
 * lender (Service Finance and Synchrony, say). It lists them in the order
 * it wants them tried; each customer is offered one at a time -- the one
 * picked on their estimate, or the first that's on -- and a lender that
 * says no can be swapped for the next with one click.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const SF = "https://apply.svcfin.com/home/dealerAuthentication?id=1&key=2";
const SY = "https://apply.example-synchrony.test/dealer/123";

const rows = [
  { id: "sy", name: "Synchrony", apply_url: SY, fee_bp: 650, active: true, sort_order: 1, created_at: "2026-10-07T10:00:00Z" },
  { id: "sf", name: "Service Finance", apply_url: SF, fee_bp: 990, active: true, sort_order: 0, created_at: "2026-10-01T10:00:00Z" },
  { id: "old", name: "Old Lender", apply_url: "https://old.example.com/apply", fee_bp: null, active: false, sort_order: 2, created_at: "2026-09-01T10:00:00Z" },
];
const lenders = lendersFromRows(rows);

test("the company's lenders, in the order they're tried", () => {
  assert.deepEqual(
    lenders.map((l) => [l.id, l.name, l.feeBp, l.active]),
    [
      ["sf", "Service Finance", 990, true],
      ["sy", "Synchrony", 650, true],
      ["old", "Old Lender", null, false],
    ]
  );
  // Offered to customers: on, with a link that works.
  assert.deepEqual(usableLenders(lenders).map((l) => l.id), ["sf", "sy"]);
  const broken = lendersFromRows([{ ...rows[1], apply_url: "https://apply.svcfin.com/embedded" }]);
  assert.deepEqual(usableLenders(broken), []);
});

test("before 0220 the one lender is the company's settings, with its fee", () => {
  assert.deepEqual(lendersFromProfile({ financing_provider: "Service Finance", financing_url: SF, financing_fee_bp: 990 }), [
    { id: null, name: "Service Finance", url: SF, feeBp: 990, active: true, sortOrder: 0 },
  ]);
  assert.deepEqual(lendersFromProfile({ financing_provider: "Service Finance", financing_url: null }), []);
  assert.deepEqual(lendersFromProfile(null), []);
});

test("each estimate has one lender: the one picked, else the first that's on", () => {
  // Nothing picked: the first lender.
  assert.deepEqual(estimateLender({ source: null, lender: null }, lenders), {
    name: "Service Finance",
    own: false,
    applyUrl: SF,
    id: "sf",
    feeBp: 990,
  });
  // Picked: that one, with its own fee.
  assert.deepEqual(estimateLender({ source: "company", lender: null, lenderId: "sy" }, lenders), {
    name: "Synchrony",
    own: false,
    applyUrl: SY,
    id: "sy",
    feeBp: 650,
  });
  // Picked, then turned off in Settings: still who it was with (a payout
  // still comes from them), but no link for the customer.
  assert.deepEqual(estimateLender({ source: "company", lender: null, lenderId: "old" }, lenders), {
    name: "Old Lender",
    own: false,
    applyUrl: null,
    id: "old",
    feeBp: null,
  });
  // A lender since removed: the first that's on.
  assert.equal(estimateLender({ source: "company", lender: null, lenderId: "gone" }, lenders)?.id, "sf");
  // The customer's own, and none, as before.
  assert.deepEqual(estimateLender({ source: "customer", lender: " Harbor Credit Union " }, lenders), {
    name: "Harbor Credit Union",
    own: true,
    applyUrl: null,
    id: null,
    feeBp: null,
  });
  assert.equal(estimateLender({ source: "none", lender: null }, lenders), null);
  assert.equal(estimateLender({ source: null, lender: null }, []), null);
});

test("after a no, the next lender in order that hasn't already said no", () => {
  assert.equal(nextLender(lenders, "sf", ["Service Finance"])?.id, "sy");
  // Synchrony was picked first and said no: Service Finance hasn't been tried.
  assert.equal(nextLender(lenders, "sy", ["Synchrony"])?.id, "sf");
  // Both have said no (names as the steps keep them): nobody left.
  assert.equal(nextLender(lenders, "sy", ["synchrony ", "Service Finance"]), null);
  // A lender that's off is never next.
  assert.equal(nextLender(lenders, "sf", ["Service Finance", "Synchrony"]), null);
});

test("adding or editing a lender: a name, a customer link, and a fee if known", () => {
  assert.equal(lenderSettingsError({ name: "Synchrony", url: SY, feePercent: "6.5" }), null);
  assert.equal(lenderSettingsError({ name: "Synchrony", url: SY, feePercent: "" }), null);
  assert.equal(lenderSettingsError({ name: "", url: SY, feePercent: "" }), "Say which lender it is: customers see the name.");
  assert.equal(lenderSettingsError({ name: "Synchrony", url: "", feePercent: "" }), "Paste the application link your lender gave you.");
  assert.match(lenderSettingsError({ name: "Service Finance", url: "https://apply.svcfin.com/embedded", feePercent: "" }) ?? "", /dealerAuthentication/);
  assert.equal(lenderSettingsError({ name: "Synchrony", url: SY, feePercent: "60" }), "Enter a fee from 0% to 50%.");
});

test("moving a lender up or down swaps it with its neighbour", () => {
  const list: Pick<CompanyLender, "id" | "sortOrder">[] = [
    { id: "a", sortOrder: 0 },
    { id: "b", sortOrder: 1 },
    { id: "c", sortOrder: 5 },
  ];
  assert.deepEqual(reorderLenders(list, "c", "up"), [
    { id: "a", sortOrder: 0 },
    { id: "c", sortOrder: 1 },
    { id: "b", sortOrder: 2 },
  ]);
  assert.deepEqual(reorderLenders(list, "a", "down").map((l) => l.id), ["b", "a", "c"]);
  // Already at the top: nothing moves.
  assert.deepEqual(reorderLenders(list, "a", "up").map((l) => l.id), ["a", "b", "c"]);
});

test("0220 adds the list, copies the company's lender into it, and is locked down", () => {
  const sql = source("../../supabase/migrations/0220_financing_lenders.sql");
  assert.match(sql, /create table if not exists public\.financing_lenders/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /current_member_company_ids\(\)/);
  assert.match(sql, /select public\.apply_billing_lock_policies\(\);/);
  assert.match(sql, /add column if not exists financing_lender_id uuid references public\.financing_lenders \(id\) on delete set null/);
  // The lender a company already has, with its fee, once.
  assert.match(sql, /insert into public\.financing_lenders[\s\S]*financing_fee_bp[\s\S]*from public\.company_profile[\s\S]*not exists/);
  assert.match(source("./backup-scope.ts"), /"financing_lenders"/);
  assert.match(source("./schema-drift.ts"), /0220_financing_lenders\.sql/);
});

test("every page and action takes the lender from the list", () => {
  for (const file of [
    "../app/portal/estimates/[id]/page.tsx",
    "../app/(app)/estimates/[id]/page.tsx",
    "./actions/financing.ts",
    "./actions/payment-change.ts",
  ]) {
    const text = source(file);
    assert.match(text, /companyLenders\(/, file);
    assert.doesNotMatch(text, /readFinancing\(/, file);
  }
  // The customer sees only the estimate's lender.
  const portal = source("../app/portal/estimates/[id]/page.tsx");
  assert.match(portal, /estimateLender\(/);
  assert.match(portal, /financing_lender_id/);
  // Trying the next lender is the office's, and sends its link.
  const actions = source("./actions/financing.ts");
  assert.match(actions, /export async function tryNextLender\(/);
  assert.match(actions, /nextLender\(/);
});
