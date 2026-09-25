/**
 * Who the client is, said the same way on every screen, document, alert
 * and report.
 *
 * A Company contact's client is the company; the person on the card
 * ("Josh" at Coast to Coast) is only its contact, shown under it where
 * a human needs reaching. An Individual is their own name. The switch is
 * the card's Contact Type, not whether company_name happens to be filled
 * -- CSV imports carry an employer on individuals.
 *
 * Returns "" when nothing is known so each caller keeps its own fallback
 * ("Customer" on a document, "Unnamed" in a list).
 */
export type ClientNameFields = {
  contact_type?: string | null;
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

/** Exactly SQL's trim(first || ' ' || last), so search and lists agree. */
export function personName(l: ClientNameFields | null | undefined): string {
  return `${l?.first_name ?? ""} ${l?.last_name ?? ""}`.trim();
}

function companyOf(l: ClientNameFields | null | undefined): string {
  return l?.contact_type === "Company" ? l.company_name || "" : "";
}

/**
 * Mirrors SQL lead_display_name (0170) minus its "Unnamed" fallbacks: a
 * company with no name yet is "" -- never quietly its contact person.
 */
export function clientName(l: ClientNameFields | null | undefined): string {
  return l?.contact_type === "Company" ? companyOf(l) : personName(l);
}

/** The company a customer signs on behalf of; null for an individual. */
export function clientCompanyName(l: ClientNameFields | null | undefined): string | null {
  return companyOf(l) || null;
}

/** The person to ask for at a company client; null for an individual. */
export function clientContactName(l: ClientNameFields | null | undefined): string | null {
  return (companyOf(l) && personName(l)) || null;
}
