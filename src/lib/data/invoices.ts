/**
 * Invoices: a charge on top of the contract -- a permit fee, a dumpster,
 * plan copies -- that the customer pays without signing anything.
 *
 * An invoice is an `estimates` row with kind 'invoice', the way a change
 * order is: the lines, the portal page, Stripe checkout and Record
 * payment all already exist there. Issuing one stamps it Signed (the
 * status every money screen reads as "this is owed") with a single
 * billed phase, so Payments, Money to Collect and Profit & Loss pick it
 * up with no special case. What keeps it out of sales is its kind:
 * `isSellableKind` is false for it, and `addsToContractValue` below.
 */

/** INV-1042: the company's one document sequence, invoice prefix. */
export function invoiceDocNumber(sequenced: string): string {
  const digits = sequenced.replace(/^[A-Za-z]+-/, "");
  return `INV-${digits}`;
}

/** A cost plus markup, to the cent. Markup is basis points (1000 = 10%);
 *  anything not a positive number means none. */
export function withMarkupCents(cents: number, markupBp: number): number {
  const bp = Number.isFinite(markupBp) && markupBp > 0 ? markupBp : 0;
  return Math.round((cents * (10000 + bp)) / 10000);
}

export type InvoiceLineDraft = {
  name: string;
  description: string;
  amountCents: number;
  /** The job cost this line bills back, when it came from one. */
  sourceExpenseId: string | null;
  /** Show that cost's receipt to the customer under the line. */
  showReceipt: boolean;
};

/** A paid bill turned into an invoice line, at cost plus any markup. */
export function invoiceLineFromCost(
  cost: {
    id: string;
    description: string | null;
    category: string | null;
    vendorName: string | null;
    amount_cents: number;
  },
  markupBp: number
): InvoiceLineDraft {
  const name = cost.description?.trim() || cost.category?.trim() || "Reimbursable cost";
  const vendor = cost.vendorName?.trim();
  return {
    name,
    description: vendor ? `Paid to ${vendor}` : "",
    amountCents: withMarkupCents(cost.amount_cents, markupBp),
    sourceExpenseId: cost.id,
    showReceipt: true,
  };
}

export function invoiceTotalCents(lines: { amountCents: number }[]): number {
  return lines.reduce((sum, l) => sum + l.amountCents, 0);
}

/** Why an invoice can't be saved yet, in words for the person saving it. */
export function invoiceDraftError(lines: { name: string; amountCents: number }[]): string | null {
  if (lines.length === 0) return "Add at least one line.";
  if (lines.some((l) => !l.name.trim())) return "Every line needs a description.";
  if (lines.some((l) => !Number.isInteger(l.amountCents) || l.amountCents <= 0)) {
    return "Every line needs an amount greater than zero.";
  }
  return null;
}

/**
 * The costs already on an invoice, so the same permit can't be billed
 * twice. A draft counts -- it is about to go out -- but a cancelled
 * invoice frees its costs to be billed again.
 */
export function billedCostIds(
  lines: { source_expense_id: string | null; status: string }[]
): Set<string> {
  const ids = new Set<string>();
  for (const l of lines) {
    if (l.source_expense_id && l.status !== "Void") ids.add(l.source_expense_id);
  }
  return ids;
}

/**
 * Whether a document attached to a contract adds to what that contract
 * is worth -- the figure sales commission is paid on. Only a signed
 * change order does: it is more work sold. An invoice is money back for
 * a cost and a completion certificate carries no money at all.
 */
export function addsToContractValue(child: { kind: string | null; status: string }): boolean {
  return child.kind === "change_order" && child.status === "Signed";
}

/**
 * A contract's attached documents, split the way Projects needs them:
 * change orders (and the completion certificate, which Projects reads
 * to mark a job complete) apart from invoices. A cancelled invoice is
 * dropped -- nothing on it is owed.
 */
export function contractChildDocs<T extends { kind: string | null; status: string }>(
  docs: T[]
): { changeOrders: T[]; invoices: T[] } {
  return {
    changeOrders: docs.filter((d) => d.kind !== "invoice"),
    invoices: docs.filter((d) => d.kind === "invoice" && d.status !== "Void"),
  };
}

/** The costs whose receipts the customer is shown, one per invoice line
 *  that bills a cost back with its receipt switched on. */
export function customerReceiptCostIds(
  items: { source_expense_id?: string | null; show_source_receipt?: boolean | null }[]
): string[] {
  return items
    .filter((i) => i.source_expense_id && i.show_source_receipt !== false)
    .map((i) => i.source_expense_id as string);
}

/** The documents Money to Collect chases: signed contracts (a signed
 *  change order adds its phase to its contract) and issued invoices. */
export function collectsOnDocument(e: { kind: string | null; status: string }): boolean {
  const kind = e.kind ?? "contract";
  return (kind === "contract" || kind === "invoice") && e.status === "Signed";
}

/** The status a person reads. An invoice is stored Signed (that is what
 *  makes it owed) but nobody signed it: it was issued. */
export function documentStatusLabel(kind: string | null | undefined, status: string): string {
  return kind === "invoice" && status === "Signed" ? "Issued" : status;
}

/**
 * A billed cost's receipt, shaped as an attachment on the invoice line
 * it justifies -- the document already draws those under their line
 * (a picture inline, a PDF as a named link).
 */
export function receiptAttachment(
  itemId: string,
  cost: { id: string; receipt_url: string | null; receipt_path: string | null }
): {
  id: string;
  estimate_id: string;
  estimate_item_id: string;
  lead_file_id: string;
  caption: string;
  sort_order: number;
  file_name: string;
  file_url: string;
  content_type: null;
  file_path: string | null;
  storage_provider: string | null;
} | null {
  if (!cost.receipt_url) return null;
  const path = cost.receipt_path ?? "";
  const drive = path.startsWith("drive:");
  // Stored as receipts/<job>/<timestamp>-<name>: the name is the tail.
  const stored = !drive && path ? path.split("/").pop()!.replace(/^\d+-/, "") : "";
  return {
    id: `receipt-${cost.id}`,
    estimate_id: "",
    estimate_item_id: itemId,
    lead_file_id: "",
    caption: "Receipt",
    sort_order: 0,
    file_name: stored || "Receipt",
    file_url: cost.receipt_url,
    content_type: null,
    file_path: drive ? path.slice("drive:".length) : path || null,
    storage_provider: drive ? "google_drive" : null,
  };
}
