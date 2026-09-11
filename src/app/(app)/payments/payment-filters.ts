/**
 * The Payments page's quick search, as a pure function.
 *
 * One box narrows every table on the page by contract number, customer,
 * phase or amount. Amount matching strips $, commas, periods and spaces
 * from the query so "19200", "19,200" and "$19,200.00" all normalize to
 * a plain digit string matched straight against the cents integer's own
 * digits — the same rule the Projects page search uses.
 */

export type PaymentSearchable = {
  /** Contract number, customer name, phase title… null/undefined skipped. */
  texts: (string | null | undefined)[];
  amountsCents: number[];
};

export function matchesPaymentSearch(search: string, row: PaymentSearchable): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const haystack = row.texts.filter(Boolean).join(" ").toLowerCase();
  if (haystack.includes(q)) return true;
  // A bare digit or two over-matches (almost every amount has a "1"
  // somewhere), so amount matching only kicks in past that.
  const qDigits = q.replace(/[^0-9]/g, "");
  return (
    qDigits.length >= 2 &&
    row.amountsCents.some((cents) => String(Math.abs(cents)).includes(qDigits))
  );
}
