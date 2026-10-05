/**
 * The words a company can change (DECISIONS #121).
 *
 * A remodeler sends an "Estimate" for a "Project"; a plumber sends a
 * "Quote" for a "Job"; a solar company has a "Consultation" with an
 * "Energy Consultant". Each company picks its own word for these eight in
 * Settings › Company Words (company_profile.wording, migration 0196), and
 * what customers are sent uses them.
 *
 * Pure: no database, no Next.js -- the settings page, the server and the
 * tests all read it. A missing or broken saved word reads as the standard
 * one, so nothing a customer sees can come out blank.
 */

export const WORD_KEYS = [
  "estimate",
  "project",
  "appointment",
  "contract",
  "rep",
  "customer",
  "change_order",
  "deposit",
] as const;

export type WordKey = (typeof WORD_KEYS)[number];

/** A word's singular and plural, as a title: "Work Order", "Work Orders". */
export type WordForm = { one: string; many: string };

export type CompanyWords = Record<WordKey, WordForm>;

const pair = (one: string, many: string): WordForm => ({ one, many });

export const STANDARD_WORDS: CompanyWords = {
  estimate: pair("Estimate", "Estimates"),
  project: pair("Project", "Projects"),
  appointment: pair("Appointment", "Appointments"),
  contract: pair("Contract", "Contracts"),
  rep: pair("Rep", "Reps"),
  customer: pair("Customer", "Customers"),
  change_order: pair("Change Order", "Change Orders"),
  deposit: pair("Deposit", "Deposits"),
};

/** The ready-made choices for each word, standard first. A company can also type its own. */
export const WORD_CHOICES: Record<WordKey, WordForm[]> = {
  estimate: [STANDARD_WORDS.estimate, pair("Proposal", "Proposals"), pair("Quote", "Quotes"), pair("Bid", "Bids")],
  project: [
    STANDARD_WORDS.project,
    pair("Job", "Jobs"),
    pair("Work Order", "Work Orders"),
    pair("Service Call", "Service Calls"),
    pair("Installation", "Installations"),
  ],
  appointment: [
    STANDARD_WORDS.appointment,
    pair("Consultation", "Consultations"),
    pair("Inspection", "Inspections"),
    pair("Visit", "Visits"),
    pair("Site Visit", "Site Visits"),
    pair("Service Call", "Service Calls"),
  ],
  contract: [STANDARD_WORDS.contract, pair("Agreement", "Agreements"), pair("Work Authorization", "Work Authorizations")],
  rep: [
    STANDARD_WORDS.rep,
    pair("Sales Rep", "Sales Reps"),
    pair("Consultant", "Consultants"),
    pair("Estimator", "Estimators"),
    pair("Technician", "Technicians"),
    pair("Energy Consultant", "Energy Consultants"),
  ],
  customer: [STANDARD_WORDS.customer, pair("Client", "Clients"), pair("Homeowner", "Homeowners")],
  change_order: [STANDARD_WORDS.change_order, pair("Amendment", "Amendments"), pair("Addendum", "Addenda")],
  deposit: [STANDARD_WORDS.deposit, pair("Down Payment", "Down Payments"), pair("Retainer", "Retainers")],
};

/**
 * The words customers already see, and where -- the settings page shows
 * only these, so no setting does nothing. All eight since DECISIONS #123.
 */
export const LIVE_WORD_KEYS: readonly WordKey[] = WORD_KEYS;

export const WORD_WHERE: Partial<Record<WordKey, string>> = {
  estimate:
    "The text and email when you send one, its title on the document, and the customer portal (your list, the progress steps, the sign and decline buttons).",
  project:
    "Emails, documents (\"Project\", \"Project location\"), the customer portal (status, notes, payments) and the card payment page.",
  contract:
    "Documents (\"Original contract\", \"Due upon contract signing\") and the customer portal after a change order or certificate is signed.",
  customer: "Who signs, on documents and their PDFs.",
  change_order: "The text and email when you send one, the banner on the document, and its sign buttons in the portal.",
  deposit: "The payment schedule on documents, the portal's deposit card, and the card payment page.",
  appointment:
    "Quick texts (confirm, reschedule, on my way, running late), the AI receptionist's offer and text, and the portal's appointment cards and progress steps.",
  rep: "Quick texts, when nobody is assigned yet (\"this is your rep\").",
};

/** The settings page's label for each word. */
export const WORD_LABELS: Record<WordKey, string> = {
  estimate: "Estimate",
  project: "Project",
  appointment: "Appointment",
  contract: "Contract",
  rep: "Rep",
  customer: "Customer",
  change_order: "Change order",
  deposit: "Deposit",
};

export const MAX_WORD_LENGTH = 30;

// Letters, digits, spaces and a little punctuation: these go into text
// messages (where anything outside plain characters doubles the cost of
// every message) and emails, so no markup, links or emoji.
const PLAIN_WORD = /^[A-Za-z0-9][A-Za-z0-9 '&-]*$/;

/** Why a typed word can't be saved, or null. */
export function wordProblem(form: { one?: unknown; many?: unknown }): string | null {
  const one = typeof form.one === "string" ? form.one.trim() : "";
  const many = typeof form.many === "string" ? form.many.trim() : "";
  if (!one) return "Type the singular.";
  if (!many) return "Type the plural.";
  for (const value of [one, many]) {
    if (value.length > MAX_WORD_LENGTH) return `Keep it to ${MAX_WORD_LENGTH} characters.`;
    if (!PLAIN_WORD.test(value)) return "Use letters, numbers, spaces, hyphens, apostrophes or &.";
  }
  return null;
}

/** A company's words: what it saved, the standard word for anything missing or broken. */
export function readCompanyWords(stored: unknown): CompanyWords {
  const saved = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const out = { ...STANDARD_WORDS };
  for (const key of WORD_KEYS) {
    const value = saved[key];
    if (!value || typeof value !== "object") continue;
    const form = value as { one?: unknown; many?: unknown };
    if (wordProblem(form)) continue;
    out[key] = { one: String(form.one).trim(), many: String(form.many).trim() };
  }
  return out;
}

/**
 * What a save stores: only the words that differ from the standard ones,
 * trimmed -- so a word the app later improves reaches every company that
 * never changed it. The first problem found stops the save.
 */
export function storedWords(
  input: Partial<Record<WordKey, { one?: unknown; many?: unknown }>>
): { words: Partial<CompanyWords> } | { error: string } {
  const words: Partial<CompanyWords> = {};
  for (const key of WORD_KEYS) {
    const form = input[key];
    if (!form) continue;
    const problem = wordProblem(form);
    if (problem) {
      const missing = problem.startsWith("Type the");
      const example = problem.includes("plural") ? STANDARD_WORDS[key].many : STANDARD_WORDS[key].one;
      const said = problem.charAt(0).toLowerCase() + problem.slice(1).replace(/\.$/, "");
      return { error: `${WORD_LABELS[key]}: ${said}${missing ? `, e.g. ${example}` : ""}.` };
    }
    const one = String(form.one).trim();
    const many = String(form.many).trim();
    if (one === STANDARD_WORDS[key].one && many === STANDARD_WORDS[key].many) continue;
    words[key] = { one, many };
  }
  return { words };
}

/**
 * Lower case for the middle of a sentence, keeping acronyms: "Work Order"
 * becomes "work order", "HVAC Visit" becomes "HVAC visit".
 */
function lowerInSentence(value: string): string {
  return value
    .split(" ")
    .map((part) => ((part.match(/[A-Z]/g)?.length ?? 0) > 1 ? part : part.toLowerCase()))
    .join(" ");
}

/**
 * A company's word, ready for a sentence: `many` for the plural, `lower`
 * for the middle of a sentence, `a` for "a"/"an" in front.
 */
export function word(
  words: CompanyWords,
  key: WordKey,
  opts: { many?: boolean; lower?: boolean; a?: boolean } = {}
): string {
  return formText(words[key] ?? STANDARD_WORDS[key], opts);
}

/** The same, for a word that isn't one of the eight ("Invoice"). */
export function formText(form: WordForm, opts: { many?: boolean; lower?: boolean; a?: boolean } = {}): string {
  const raw = opts.many ? form.many : form.one;
  const text = opts.lower ? lowerInSentence(raw) : raw;
  if (!opts.a) return text;
  // An acronym is said letter by letter: "an HVAC visit", "a UV inspection".
  const first = text.split(" ")[0];
  const acronym = /^[A-Z0-9]{2,}$/.test(first);
  const vowelSound = acronym ? /^[AEFHILMNORSX8]/.test(first) : /^[aeiou]/i.test(first);
  return `${vowelSound ? "an" : "a"} ${text}`;
}
