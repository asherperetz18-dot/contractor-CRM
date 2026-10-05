import { STANDARD_WORDS, formText, word, type CompanyWords, type WordForm } from "./company-words.ts";

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
    totalLabel: isChangeOrder ? `This ${word(words, "change_order", { lower: true })}` : isInvoice ? "Amount due" : "Total",
    deposit: word(words, "deposit"),
    depositDue: `Due upon ${contract} signing`,
    customerParty: word(words, "customer"),
    contractorParty: "Contractor",
  };
}
