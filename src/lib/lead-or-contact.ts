/**
 * Contact or lead (DECISIONS #156). Everyone on the Pipeline is a
 * contact; a contact counts as a lead only when it came from a real lead
 * source -- Meta, Google, the website, a referral -- never from a bought
 * cold-call list. Which sources are bought lists is the "Bought list"
 * tick in Settings > Lead Sources (lead_sources.bought_list, 0165).
 */

type SourceOption = { id: string; name: string; bought_list?: boolean };

/** The sources Quick Create's New Lead offers: everything not ticked as
 *  a bought list. Before 0165 runs the flag is absent and all qualify. */
export function realLeadSources<T extends SourceOption>(sources: T[]): T[] {
  return sources.filter((s) => s.bought_list !== true);
}

type ContactFormFields = {
  contact_type: "Individual" | "Company";
  company_name: string;
  first_name: string;
  last_name: string;
  phone: string;
  source: string;
};

/** Whether the contact window has what it needs to save: a name and a
 *  phone, and for a New Lead its source as well -- a lead saved without
 *  one would count as a plain contact. */
export function contactFormComplete(form: ContactFormFields, opts: { asLead: boolean }): boolean {
  const named =
    form.contact_type === "Company"
      ? !!(form.company_name.trim() && form.phone.trim())
      : !!(form.first_name.trim() && form.last_name.trim() && form.phone.trim());
  return named && (!opts.asLead || !!form.source.trim());
}
