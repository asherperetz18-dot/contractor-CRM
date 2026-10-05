import { moneyCents } from "./data/types.ts";
import { STANDARD_WORDS, formText, word, type CompanyWords } from "./company-words.ts";
import { documentWord } from "./document-words.ts";

export { documentWord };

// A copy of email-env.ts's escapeHtml, not an import of it: that module
// starts with `import "server-only"`, which would make this file unusable
// from the send drawer (a client component, via the preview action's
// return value flowing through it) and untestable under `node --test` --
// same reason bulk-email.ts and inbound-email.ts stay free of it.
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

type SendCopy = {
  companyName: string;
  docNumber: string;
  kind?: string | null;
  words?: CompanyWords;
};

/** An invoice is there to view (and pay); everything else to review and sign. */
const isInvoice = (kind: string | null | undefined) => kind === "invoice";

/** The email's subject line. */
export function documentSendSubject(p: SendCopy): string {
  const noun = formText(documentWord(p.kind, p.words), { lower: true });
  return `${p.companyName}: your ${noun} ${p.docNumber} is ready to review`;
}

/**
 * The text message. Plain hyphens and no emoji: an em dash or emoji
 * flips the message to UCS-2 and cuts each segment from 160 characters
 * to 70. (Company words can't carry either -- company-words.ts.)
 */
export function documentSendSms(p: SendCopy & { link: string }): string {
  const noun = formText(documentWord(p.kind, p.words), { lower: true });
  const ready = isInvoice(p.kind) ? "is ready to view." : "is ready to review and sign.";
  return `${p.companyName}: your ${noun} ${p.docNumber} ${ready}\n${p.link}\n\nLink expires in 7 days.`;
}

/** The email button's label. */
export function documentCallToAction(kind: string | null | undefined): string {
  return isInvoice(kind) ? "View Invoice" : "Review & Sign";
}

/** The line under the button. */
export function documentQuestionsLine(kind: string | null | undefined, words: CompanyWords = STANDARD_WORDS): string {
  const noun = formText(documentWord(kind, words), { lower: true });
  return `If you have any questions about the ${noun} or would like to discuss any changes, please feel free to reach out.`;
}

/**
 * The default customer-facing body of a sent document -- shown to the rep
 * before sending (and, if they edit it, replaced by their text) rather
 * than the email being entirely opaque until it lands in an inbox.
 *
 * Each kind says what it is, in the company's words: an estimate gives
 * its grand total, a change order its own total, a completion certificate
 * no price at all, an invoice the amount due.
 */
export function defaultEstimateNarrative(params: {
  companyName: string;
  docNumber: string;
  title: string | null;
  projectAddress: string | null;
  totalCents: number;
  kind?: string | null;
  words?: CompanyWords;
}): string {
  const { companyName, docNumber, title, projectAddress, totalCents, kind } = params;
  const words = params.words ?? STANDARD_WORDS;
  const amount = moneyCents(totalCents);
  const noun = formText(documentWord(kind, words), { lower: true });
  const project = word(words, "project", { lower: true });
  // Dropped whole rather than left with a hole behind them -- a document
  // with no title or a lead with no address must still read as a
  // complete sentence.
  const onProjectClause = title ? ` on your ${title} ${project}` : "";
  const atAddressClause = projectAddress ? ` at ${projectAddress}` : "";
  const prepared = `${companyName} has prepared ${noun} #${docNumber} for your ${project}${atAddressClause}.`;

  if (kind === "change_order") {
    return [
      `${prepared} The total of this ${noun} is ${amount}.`,
      `Please use the link below to review the ${noun}, including what changes and the price. If everything looks good, you can accept and sign it online.`,
    ].join("\n\n");
  }
  if (kind === "completion") {
    return [
      prepared,
      `Please use the link below to review it. If the work is complete, you can sign it online.`,
    ].join("\n\n");
  }
  if (isInvoice(kind)) {
    return [
      `${companyName} has sent ${noun} #${docNumber} for your ${project}${atAddressClause}. The amount due is ${amount}.`,
      `Please use the link below to view the ${noun}.`,
    ].join("\n\n");
  }
  return [
    `Thank you for the opportunity to work with you${onProjectClause}.`,
    `${prepared} The grand total of the ${noun} is ${amount}.`,
    `Please use the link below to review the full ${noun}, including the scope of work and pricing. If everything looks good, you can also accept and sign the ${noun} directly online.`,
  ].join("\n\n");
}

/** Plain text, paragraphs separated by a blank line, into escaped `<p>` tags. */
export function paragraphsToHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("\n");
}
