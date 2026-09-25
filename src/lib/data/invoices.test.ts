import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addsToContractValue,
  contractChildDocs,
  customerReceiptCostIds,
  collectsOnDocument,
  documentStatusLabel,
  receiptAttachment,
  billedCostIds,
  invoiceDocNumber,
  invoiceDraftError,
  invoiceLineFromCost,
  invoiceTotalCents,
  withMarkupCents,
} from "./invoices.ts";
import { isSellableKind } from "./types.ts";

/**
 * An invoice is a charge on top of the contract -- a permit fee, a
 * dumpster, plan copies -- that the customer pays without signing
 * anything. These pin the three things that make it trustworthy: the
 * money is exact, a cost can't be billed twice, and an invoice is never
 * mistaken for a sale.
 */

test("an invoice shares the company's number sequence under its own prefix", () => {
  assert.equal(invoiceDocNumber("EST-1042"), "INV-1042");
  // Whatever the sequence hands back, the number keeps its digits.
  assert.equal(invoiceDocNumber("1043"), "INV-1043");
});

test("markup is off at zero and rounds to the cent when on", () => {
  assert.equal(withMarkupCents(41250, 0), 41250);
  assert.equal(withMarkupCents(41250, 1000), 45375); // +10%
  assert.equal(withMarkupCents(333, 1500), 383); // 382.95 rounds up
  // A negative or junk markup never discounts a pass-through.
  assert.equal(withMarkupCents(41250, -500), 41250);
  assert.equal(withMarkupCents(41250, Number.NaN), 41250);
});

test("a bill becomes a line at cost, naming what it was and who was paid", () => {
  const line = invoiceLineFromCost(
    {
      id: "cost-1",
      description: "Building permit BLD-2026-04417",
      category: "Permits",
      vendorName: "City of Pasadena",
      amount_cents: 41250,
    },
    0
  );
  assert.deepEqual(line, {
    name: "Building permit BLD-2026-04417",
    description: "Paid to City of Pasadena",
    amountCents: 41250,
    sourceExpenseId: "cost-1",
    showReceipt: true,
  });
});

test("a bill with no description falls back to its category, then a plain label", () => {
  const byCategory = invoiceLineFromCost(
    { id: "c", description: " ", category: "Dumpster", vendorName: null, amount_cents: 65000 },
    0
  );
  assert.equal(byCategory.name, "Dumpster");
  assert.equal(byCategory.description, "");
  const bare = invoiceLineFromCost(
    { id: "c", description: null, category: null, vendorName: null, amount_cents: 100 },
    0
  );
  assert.equal(bare.name, "Reimbursable cost");
});

test("markup on a billed cost is carried into the line amount", () => {
  const line = invoiceLineFromCost(
    { id: "c", description: "Dumpster", category: null, vendorName: null, amount_cents: 65000 },
    1000
  );
  assert.equal(line.amountCents, 71500);
});

test("the total is the sum of the lines, in cents", () => {
  assert.equal(
    invoiceTotalCents([
      { amountCents: 41250 },
      { amountCents: 3500 },
    ]),
    44750
  );
  assert.equal(invoiceTotalCents([]), 0);
});

test("an invoice needs at least one named line, and every line a real amount", () => {
  assert.equal(invoiceDraftError([]), "Add at least one line.");
  assert.equal(
    invoiceDraftError([{ name: "", amountCents: 100 }]),
    "Every line needs a description."
  );
  assert.equal(
    invoiceDraftError([{ name: "Permit", amountCents: 0 }]),
    "Every line needs an amount greater than zero."
  );
  assert.equal(
    invoiceDraftError([{ name: "Permit", amountCents: 10.5 }]),
    "Every line needs an amount greater than zero."
  );
  assert.equal(invoiceDraftError([{ name: "Permit", amountCents: 41250 }]), null);
});

test("a cost on a live invoice is billed; one on a cancelled invoice is free again", () => {
  const billed = billedCostIds([
    { source_expense_id: "permit", status: "Signed" },
    { source_expense_id: "draft-only", status: "Draft" },
    { source_expense_id: "cancelled", status: "Void" },
    { source_expense_id: null, status: "Signed" },
  ]);
  assert.deepEqual([...billed].sort(), ["draft-only", "permit"]);
});

test("an invoice is never a sale", () => {
  assert.equal(isSellableKind("invoice"), false);
});

test("only a signed change order adds to what the contract is worth", () => {
  // Commission and the contract's value read this. An invoice is money
  // back for a cost, not more work sold, so it never counts -- signed
  // (issued) or not. Nor does the completion certificate.
  assert.equal(addsToContractValue({ kind: "change_order", status: "Signed" }), true);
  assert.equal(addsToContractValue({ kind: "change_order", status: "Sent" }), false);
  assert.equal(addsToContractValue({ kind: "invoice", status: "Signed" }), false);
  assert.equal(addsToContractValue({ kind: "completion", status: "Signed" }), false);
});

test("a contract's documents split into change orders and invoices", () => {
  const docs = [
    { id: "co", kind: "change_order", status: "Signed" },
    { id: "cert", kind: "completion", status: "Draft" },
    { id: "inv", kind: "invoice", status: "Signed" },
    { id: "gone", kind: "invoice", status: "Void" },
  ];
  const split = contractChildDocs(docs);
  // The certificate stays with the change orders: Projects reads it
  // there to mark the job complete.
  assert.deepEqual(split.changeOrders.map((d) => d.id), ["co", "cert"]);
  // A cancelled invoice is off the job; a live one is money it's owed.
  assert.deepEqual(split.invoices.map((d) => d.id), ["inv"]);
});

test("the customer sees a line's receipt only when the line bills a cost and it's switched on", () => {
  assert.deepEqual(
    customerReceiptCostIds([
      { source_expense_id: "permit", show_source_receipt: true },
      { source_expense_id: "hidden", show_source_receipt: false },
      { source_expense_id: null, show_source_receipt: true },
      // Before migration 0179 neither column exists on the row.
      {},
    ]),
    ["permit"]
  );
});

test("money is collected on signed contracts and issued invoices, nothing else", () => {
  assert.equal(collectsOnDocument({ kind: "contract", status: "Signed" }), true);
  assert.equal(collectsOnDocument({ kind: null, status: "Signed" }), true);
  assert.equal(collectsOnDocument({ kind: "invoice", status: "Signed" }), true);
  assert.equal(collectsOnDocument({ kind: "invoice", status: "Void" }), false);
  assert.equal(collectsOnDocument({ kind: "contract", status: "Sent" }), false);
  // A signed change order's money lands on its parent contract's schedule.
  assert.equal(collectsOnDocument({ kind: "change_order", status: "Signed" }), false);
});

test("an invoice reads Issued where a contract reads Signed", () => {
  assert.equal(documentStatusLabel("invoice", "Signed"), "Issued");
  assert.equal(documentStatusLabel("invoice", "Void"), "Void");
  assert.equal(documentStatusLabel("contract", "Signed"), "Signed");
  assert.equal(documentStatusLabel(null, "Sent"), "Sent");
});

test("a stored receipt becomes an attachment under its invoice line", () => {
  const a = receiptAttachment("item-1", {
    id: "cost-1",
    receipt_url: "https://x.supabase.co/storage/v1/object/public/lead-files/receipts/j/1727000000000-permit.jpg",
    receipt_path: "receipts/j/1727000000000-permit.jpg",
  });
  assert.equal(a?.estimate_item_id, "item-1");
  assert.equal(a?.file_name, "permit.jpg");
  assert.equal(a?.storage_provider, null);
  assert.equal(a?.caption, "Receipt");
  // One kept in Google Drive keeps its Drive id for the thumbnail.
  const drive = receiptAttachment("item-2", {
    id: "cost-2",
    receipt_url: "https://drive.google.com/file/d/abc/view",
    receipt_path: "drive:abc",
  });
  assert.equal(drive?.storage_provider, "google_drive");
  assert.equal(drive?.file_path, "abc");
  assert.equal(drive?.file_name, "Receipt");
  // No file, nothing to attach.
  assert.equal(receiptAttachment("item-3", { id: "c", receipt_url: null, receipt_path: null }), null);
});
