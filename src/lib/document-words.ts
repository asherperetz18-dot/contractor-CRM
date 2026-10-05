import { STANDARD_WORDS, formText, word, type CompanyWords, type WordForm } from "./company-words.ts";
import { moneyCents, paymentPercentOfTotal } from "./data/types.ts";

/**
 * What a document is called and the labels printed on it, in the
 * company's own words (DECISIONS #121, #122). The portal's web copy
 * (components/estimate-document.tsx) and the PDF (lib/pdf/document-pdf.ts)
 * both read these, so the two can't drift apart. Pure.
 */

/** The company's word for an estimate or a change order; a completion
 *  certificate and an invoice are always called that. */
export function documentWord(kind: string | null | undefined, words: CompanyWords = STANDARD_WORDS): WordForm {
  if (kind === "change_order") return words.change_order;
  if (kind === "completion") return { one: "Completion Certificate", many: "Completion Certificates" };
  if (kind === "invoice") return { one: "Invoice", many: "Invoices" };
  return words.estimate;
}

export type DocumentLabels = {
  /** Above the number, saying what the document is; none on an estimate. */
  banner: string | null;
  /** The title when the document has none. */
  untitled: string;
  preparedFor: string;
  /** Beside the title. */
  forLabel: string;
  /** The work address, when it differs from the customer's. */
  locationLabel: string;
  /** "To contract EST-1012" on a change order or certificate. */
  parentLink: string;
  originalParent: string;
  revisedTotal: string;
  /** The bottom line. */
  totalLabel: string;
  scheduleHeading: string;
  deposit: string;
  depositDue: string;
  /** Who signs. */
  customerParty: string;
  contractorParty: string;
};

export function documentLabels(kind: string | null | undefined, words: CompanyWords = STANDARD_WORDS): DocumentLabels {
  const isChangeOrder = kind === "change_order";
  const isInvoice = kind === "invoice";
  const contract = word(words, "contract", { lower: true });
  const changeOrder = word(words, "change_order", { lower: true });
  const project = word(words, "project");
  return {
    banner: isChangeOrder
      ? word(words, "change_order").toUpperCase()
      : kind === "completion"
        ? "CERTIFICATE OF COMPLETION"
        : isInvoice
          ? "INVOICE"
          : null,
    untitled: formText(documentWord(kind, words)),
    preparedFor: isInvoice ? "Bill to" : "Prepared for",
    forLabel: isInvoice ? "For" : project,
    locationLabel: `${project} location`,
    parentLink: `${isInvoice ? "For" : "To"} ${contract}`,
    originalParent: `Original ${contract}`,
    revisedTotal: `Revised ${contract} total`,
    totalLabel: isChangeOrder ? `This ${changeOrder}` : isInvoice ? "Amount due" : "Total",
    // Its own schedule, said so: the contract's is a separate one.
    scheduleHeading: isChangeOrder ? `Payment schedule for this ${changeOrder}` : "Payment schedule",
    deposit: word(words, "deposit"),
    // The contract was signed long before; this deposit is due on this one.
    depositDue: isChangeOrder ? `Due when you sign this ${changeOrder}` : `Due upon ${contract} signing`,
    customerParty: word(words, "customer"),
    contractorParty: "Contractor",
  };
}

/**
 * What a document prints under its totals about paying for it.
 *
 * A change order prints its own schedule when it has one: that is what
 * its money is collected on (DECISIONS #015), so the customer signing it
 * reads when each part is due. One with no stages of its own is billed
 * as the single row signing adds to its contract's schedule, and says so.
 * An invoice prints none -- its Pay card is its payment terms.
 */
export type PaymentSection = "schedule" | "one-payment" | null;

export function documentPaymentSection(doc: {
  kind: string | null | undefined;
  depositCents: number | null | undefined;
  phaseCount: number;
  totalCents: number;
  hasParent: boolean;
}): PaymentSection {
  if (doc.kind === "invoice") return null;
  if (doc.depositCents || doc.phaseCount > 0) return "schedule";
  // Nothing to say without the contract to name, or with nothing owed.
  if (doc.kind === "change_order" && doc.hasParent && doc.totalCents !== 0) return "one-payment";
  return null;
}

/** Under a change order's own schedule: extra payments, not new terms for the contract's. */
export function changeOrderScheduleNote(parentDoc: string, words: CompanyWords = STANDARD_WORDS): string {
  return (
    `These payments are for this ${word(words, "change_order", { lower: true })} only. ` +
    `They don't change the payments already scheduled on your ${word(words, "contract", { lower: true })} ${parentDoc}.`
  );
}

/** A change order with no stages of its own: the one row signing adds to the contract. */
export function changeOrderOnePaymentLine(
  totalCents: number,
  parentDoc: string,
  words: CompanyWords = STANDARD_WORDS
): string {
  const contract = `your ${word(words, "contract", { lower: true })} ${parentDoc}`;
  // A credit is money back, not a payment of minus $500.
  return totalCents < 0
    ? `A credit of ${moneyCents(-totalCents)}, taken off the payment schedule of ${contract}.`
    : `Billed as one payment of ${moneyCents(totalCents)}, added to the payment schedule of ${contract}.`;
}

/** A stage's share of the document's total, as both copies print it. */
export function paymentPercentLabel(amountCents: number, totalCents: number): string | null {
  const p = paymentPercentOfTotal(amountCents, totalCents);
  return p === null ? null : `${p.toFixed(2)}%`;
}
