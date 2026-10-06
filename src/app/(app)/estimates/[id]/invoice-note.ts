/**
 * What happened when a draft invoice was sent, handed from the draft
 * editor to the issued invoice page that replaces it (DECISIONS #149).
 * Sending swaps one for the other, so a "the text didn't go out" said
 * in the editor would vanish with it -- and the person would believe the
 * customer had the Pay link. Kept in this tab's session storage, which
 * can be unavailable (a private window): then the note is simply lost,
 * never an error.
 */

const key = (invoiceId: string) => `invoice-note:${invoiceId}`;

export function stashInvoiceNote(invoiceId: string, note: string): void {
  try {
    sessionStorage.setItem(key(invoiceId), note);
  } catch {
    // No storage: the issued page shows no note.
  }
}

/** The note waiting for this invoice, if any; it stays until cleared. */
export function peekInvoiceNote(invoiceId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(key(invoiceId));
  } catch {
    return null;
  }
}

export function clearInvoiceNote(invoiceId: string): void {
  try {
    sessionStorage.removeItem(key(invoiceId));
  } catch {
    // Nothing to clear.
  }
}

/** What a successful send says. */
export function issuedNote(docNumber: string, sentTo: string | undefined): string {
  return sentTo
    ? `${docNumber} sent — Pay link sent to ${sentTo}.`
    : `${docNumber} issued. It's on the customer's portal with a Pay button.`;
}
