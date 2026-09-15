import { moneyCents } from "./data/types.ts";

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

/**
 * The default customer-facing body of a sent estimate -- the same three
 * paragraphs `buildEstimateEmail` has always sent, extracted so a rep can
 * be shown this exact text before sending (and, if they edit it, so the
 * edited text can replace it) rather than the email being entirely opaque
 * until it lands in an inbox.
 */
export function defaultEstimateNarrative(params: {
  companyName: string;
  docNumber: string;
  title: string | null;
  projectAddress: string | null;
  totalCents: number;
}): string {
  const { companyName, docNumber, title, projectAddress, totalCents } = params;
  const amount = moneyCents(totalCents);
  // Dropped whole rather than left with a hole behind them -- an estimate
  // with no title or a lead with no address must still read as a complete
  // sentence.
  const onProjectClause = title ? ` on your ${title} project` : "";
  const atAddressClause = projectAddress ? ` at ${projectAddress}` : "";

  return [
    `Thank you for the opportunity to work with you${onProjectClause}.`,
    `${companyName} has prepared proposal #${docNumber} for your project${atAddressClause}. The grand total of the proposal is ${amount}.`,
    `Please use the link below to review the full proposal, including the scope of work and pricing. If everything looks good, you can also accept and sign the proposal directly online.`,
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
