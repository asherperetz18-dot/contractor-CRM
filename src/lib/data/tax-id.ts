/**
 * The Company Tax ID as the Company Profile page edits it. Free text on
 * purpose: an EIN ("12-3456789"), an SSN for a sole proprietor, or a
 * state tax number are all valid, so no format is enforced -- only
 * whitespace is cleaned up, and blank clears the stored value.
 */
export function normalizeTaxId(input: string): string | null {
  return input.trim() || null;
}
