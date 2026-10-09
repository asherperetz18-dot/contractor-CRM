/**
 * Company-level documents shown to customers.
 *
 * A plain module, not a "use server" file: both the settings editor and
 * the portal need these, and a "use server" file may only export async
 * functions.
 */

// Relative and with the extension, not "@/...": this module runs under
// node's test runner (via company-docs.test.ts), which resolves no
// tsconfig path aliases -- same idiom as every *.test.ts import.
import { addDays } from "../company-clock.ts";

export type CompanyDocKind = "license" | "insurance" | "bond" | "other";

export const COMPANY_DOC_KINDS: { value: CompanyDocKind; label: string; hint: string }[] = [
  { value: "license", label: "Contractor licence", hint: "State contractor licence or certification" },
  { value: "insurance", label: "Insurance certificate", hint: "General liability or workers' comp" },
  { value: "bond", label: "Bond", hint: "Contractor's bond certificate" },
  { value: "other", label: "Other", hint: "Anything else worth showing a customer" },
];

export function docKindLabel(kind: string): string {
  return COMPANY_DOC_KINDS.find((k) => k.value === kind)?.label ?? "Document";
}

/**
 * Whether a certificate has lapsed, against the company's today
 * (YYYY-MM-DD). The caller says which today: the settings page and the
 * portal both pass the company's, so they agree about the same evening.
 *
 * Compared as calendar dates rather than instants: a certificate valid
 * "through 31 December" is valid all of that day, and treating the date
 * as midnight would retire it a day early in every timezone west of UTC.
 */
export function isExpired(expiresOn: string | null, today: string): boolean {
  if (!expiresOn) return false;
  return expiresOn < today;
}

/** Inside the window where somebody should be chasing a renewal: the
 *  next `days` of the company's calendar, today included. */
export function expiringSoon(expiresOn: string | null, today: string, days = 30): boolean {
  if (!expiresOn || isExpired(expiresOn, today)) return false;
  return expiresOn <= addDays(today, days);
}
