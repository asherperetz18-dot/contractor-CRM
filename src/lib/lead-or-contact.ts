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

/** How a source name is compared: case and surrounding spaces ignored,
 *  the way public.counts_as_lead and the lead-cost trigger compare it. */
export function sourceKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/** The keys of the sources ticked as bought lists, each once. */
export function boughtListKeys(sources: { name: string; bought_list?: boolean }[]): string[] {
  return [...new Set(sources.filter((s) => s.bought_list === true).map((s) => sourceKey(s.name)))].filter(
    Boolean
  );
}

/**
 * The rule: a contact counts as a lead unless it has no source or its
 * source is ticked as a bought list. A source nobody ticked counts even
 * when it isn't on the Settings list -- CallRail files calls under its
 * own text ("Google Ads"). Mirrored by public.counts_as_lead (0211).
 */
export function countsAsLead(source: string | null | undefined, boughtKeys: string[]): boolean {
  const key = sourceKey(source);
  return key !== "" && !boughtKeys.includes(key);
}

/**
 * The same rule as a database filter: the sources that are NOT leads (a
 * blank one, or a bought list, any case, any surrounding spaces) as a
 * case-insensitive regex, for `.not("source", "imatch", pattern)`. NOT on
 * a null source is null, so sourceless rows drop out as well.
 */
export function notALeadPattern(boughtKeys: string[]): string {
  const escaped = boughtKeys.map((k) => k.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&"));
  return `^\\s*(${["", ...escaped].join("|")})\\s*$`;
}

/** The source a spreadsheet row gets when its Source cell is empty or
 *  unmapped; 0211 ticks it as a bought list. */
export const IMPORT_DEFAULT_SOURCE = "CSV Import";

/** The source names an import will write, each once (first spelling
 *  kept), a blank cell standing for IMPORT_DEFAULT_SOURCE. */
export function importSourceNames(cells: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const cell of cells) {
    const name = cell.trim() || IMPORT_DEFAULT_SOURCE;
    if (!byKey.has(sourceKey(name))) byKey.set(sourceKey(name), name);
  }
  return [...byKey.values()];
}

/** What "these are bought-list contacts" does to Settings > Lead
 *  Sources: tick the listed sources it names (any spelling) that aren't
 *  ticked yet, and add the ones the list doesn't have. */
export function boughtListPlan(
  names: string[],
  existing: { id: string; name: string; bought_list?: boolean }[]
): { tick: string[]; add: string[] } {
  const tick = new Set<string>();
  const add = new Map<string, string>();
  for (const name of names) {
    const key = sourceKey(name);
    if (!key) continue;
    const matches = existing.filter((s) => sourceKey(s.name) === key);
    if (matches.length === 0) {
      if (!add.has(key)) add.set(key, name.trim());
      continue;
    }
    for (const s of matches) if (s.bought_list !== true) tick.add(s.id);
  }
  return { tick: [...tick], add: [...add.values()] };
}

/** A Pipeline card's source tag: a real lead's says so in safety orange
 *  (one to work), a bought list's is a plain grey label. None without a
 *  source, as before. */
export function sourceTag(
  source: string | null | undefined,
  boughtKeys: string[]
): { label: string; tone: "lead" | "contact" } | null {
  const name = (source ?? "").trim();
  if (!name) return null;
  return countsAsLead(name, boughtKeys)
    ? { label: `Lead · ${name}`, tone: "lead" }
    : { label: name, tone: "contact" };
}
