import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ESTIMATE_LIST_COLUMNS, ESTIMATE_LIST_SIGNER_COLUMNS } from "./estimate-list-rows.ts";

/**
 * The Estimates list read every column of every document and every
 * signer (DECISIONS #145): each contract's full terms, its notes and
 * messages, and every hand-drawn signature as a picture -- none of which
 * the list shows. It now reads only the columns it uses. Every document
 * still comes, so the cards' totals and the search stay exact.
 */

const cols = (s: string) => s.split(",").map((c) => c.trim());

test("the list never downloads what it doesn't show", () => {
  const estimate = cols(ESTIMATE_LIST_COLUMNS);
  for (const heavy of ["terms", "notes", "customer_message", "completion_notes", "completion_customer_items", "*"]) {
    assert.ok(!estimate.includes(heavy), heavy);
  }
  const signer = cols(ESTIMATE_LIST_SIGNER_COLUMNS);
  for (const heavy of ["signature_image", "signature_ip", "signature_user_agent", "*"]) {
    assert.ok(!signer.includes(heavy), heavy);
  }
});

test("it still reads what the cards, filters and rows are drawn from", () => {
  const estimate = cols(ESTIMATE_LIST_COLUMNS);
  // Funnel cards and statuses, the salesperson seats, dates, money, search.
  for (const need of ["id", "lead_id", "kind", "status", "expires_at", "total_cents", "assigned_to", "sales_rep_1", "sales_rep_2", "closer_id", "created_at", "doc_number", "title", "job_address"]) {
    assert.ok(estimate.includes(need), need);
  }
  // Signature progress: who has signed.
  for (const need of ["estimate_id", "name", "signed_at", "sort_order"]) {
    assert.ok(cols(ESTIMATE_LIST_SIGNER_COLUMNS).includes(need), need);
  }
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the page selects those columns, and the list is typed on them", () => {
  const page = source("../../app/(app)/estimates/page.tsx");
  assert.match(page, /\.from\("estimates"\)\s*\.select\(ESTIMATE_LIST_COLUMNS\)/);
  assert.match(page, /\.from\("estimate_signers"\)\s*\.select\(ESTIMATE_LIST_SIGNER_COLUMNS\)/);
  assert.doesNotMatch(page, /from\("estimate(s|_signers)"\)\s*\.select\("\*"\)/);
  // Typed on the slim rows, so a field the list starts reading without
  // adding it here fails the build instead of reading as blank.
  const view = source("../../app/(app)/estimates/estimates-view.tsx");
  assert.match(view, /estimates: EstimateListRow\[\];/);
  assert.match(view, /signers: EstimateListSigner\[\];/);
});
