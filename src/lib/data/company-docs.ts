/**
 * Company-level documents shown to customers.
 *
 * A plain module, not a "use server" file: both the settings editor and
 * the portal need these, and a "use server" file may only export async
 * functions.
 */

export type CompanyDocKind = "license" | "insurance" | "bond" | "other";

export const COMPANY_DOC_KINDS: { value: CompanyDocKind; label: string; hint: string }[] = [
  { value: "license", label: "Contractor licence", hint: "CSLB licence or state certification" },
  { value: "insurance", label: "Insurance certificate", hint: "General liability or workers' comp" },
  { value: "bond", label: "Bond", hint: "Contractor's bond certificate" },
  { value: "other", label: "Other", hint: "Anything else worth showing a customer" },
];

export function docKindLabel(kind: string): string {
  return COMPANY_DOC_KINDS.find((k) => k.value === kind)?.label ?? "Document";
}

/**
 * Whether a certificate has lapsed.
 *
 * Compared as calendar dates rather than instants: a certificate valid
 * "through 31 December" is valid all of that day, and treating the date
 * as midnight would retire it a day early in every timezone west of UTC.
 */
export function isExpired(expiresOn: string | null, now = new Date()): boolean {
  if (!expiresOn) return false;
  const today = now.toISOString().slice(0, 10);
  return expiresOn < today;
}

/** Inside the window where somebody should be chasing a renewal. */
export function expiringSoon(expiresOn: string | null, days = 30, now = new Date()): boolean {
  if (!expiresOn || isExpired(expiresOn, now)) return false;
  const limit = new Date(now);
  limit.setDate(limit.getDate() + days);
  return expiresOn <= limit.toISOString().slice(0, 10);
}
