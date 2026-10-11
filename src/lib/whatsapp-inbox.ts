/**
 * The WhatsApp Inbox (DECISIONS #204): the pure rules. A general
 * WhatsApp group -- receipts, supply runs, odd photos -- is on no job, so
 * each photo or file it posts waits in the inbox until someone files it
 * to a job, makes it a bill or dismisses it. No runtime imports, so it's
 * tested without a database (whatsapp-inbox.test.ts).
 */

/** A job a caption can point at: one signed contract. */
export type InboxJob = {
  estimateId: string;
  leadId: string;
  label: string;
  /** The customer's names worth matching: last name, company name. */
  nameWords: string[];
  address: string | null;
  docNumber: string | null;
};

const STREET_SUFFIXES = new Set([
  "ave", "avenue", "st", "street", "rd", "road", "blvd", "boulevard", "dr", "drive", "ln", "lane",
  "ct", "court", "way", "pl", "place", "ter", "terrace", "pkwy", "parkway", "cir", "circle", "hwy",
]);
const DIRECTIONS = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw", "north", "south", "east", "west"]);

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole words only, any case: "Oak" never matches "Oakland". */
function hasWords(text: string, words: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(words)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text);
}

/**
 * The words of an address worth matching: "5420 Wortser Ave, Sherman
 * Oaks" gives the street's name "Wortser" and its suffix "Ave". A long
 * name is distinctive on its own; a short one ("Oak", "Elm") counts only
 * with its suffix, or every "oak trim" would point at a job.
 */
function streetMatch(caption: string, address: string | null): string | null {
  const first = (address ?? "").split(",")[0].trim();
  const words = first.split(/\s+/).filter((w) => w && !/^\d/.test(w));
  const suffixAt = words.findIndex((w) => STREET_SUFFIXES.has(w.toLowerCase().replace(/\.$/, "")));
  const nameWords = (suffixAt >= 0 ? words.slice(0, suffixAt) : words).filter(
    (w) => !DIRECTIONS.has(w.toLowerCase().replace(/\.$/, ""))
  );
  if (!nameWords.length) return null;
  const name = nameWords.join(" ");
  if (name.length >= 5 && hasWords(caption, name)) return name;
  if (suffixAt < 0) return null;
  const suffix = words[suffixAt].replace(/\.$/, "");
  // The suffix as written on the job, or its long or short form.
  const forms = new Set([suffix.toLowerCase(), ...longAndShort(suffix.toLowerCase())]);
  for (const form of forms) {
    if (hasWords(caption, `${name} ${form}`)) return `${name} ${suffix}`;
  }
  return null;
}

const SUFFIX_PAIRS: [string, string][] = [
  ["ave", "avenue"], ["st", "street"], ["rd", "road"], ["blvd", "boulevard"], ["dr", "drive"],
  ["ln", "lane"], ["ct", "court"], ["pl", "place"], ["ter", "terrace"], ["pkwy", "parkway"], ["cir", "circle"],
];
function longAndShort(suffix: string): string[] {
  const pair = SUFFIX_PAIRS.find((p) => p.includes(suffix));
  return pair ? [...pair] : [];
}

/** "EST-1089" is written est-1089, est1089, #1089 or a bare 1089. */
function docMatch(caption: string, docNumber: string | null): boolean {
  const digits = (docNumber ?? "").replace(/\D/g, "");
  if (digits.length < 3) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])(est-?|#)?${digits}(?=$|[^\\p{N}])`, "iu").test(caption);
}

/**
 * The job a caption points at, and the words that point there -- or
 * null. The job number decides first; then the street or the customer's
 * name. Two jobs matching is no suggestion at all: a wrong guess filed
 * in one click is worse than none.
 */
export function suggestJob(
  caption: string | null,
  jobs: InboxJob[]
): { job: InboxJob; because: string } | null {
  const text = (caption ?? "").trim();
  if (!text) return null;

  const byNumber = jobs.filter((j) => docMatch(text, j.docNumber));
  if (byNumber.length === 1) return { job: byNumber[0], because: byNumber[0].docNumber as string };
  if (byNumber.length > 1) return null;

  const hits: { job: InboxJob; because: string }[] = [];
  for (const job of jobs) {
    const street = streetMatch(text, job.address);
    const name = job.nameWords.find((w) => w.length >= 4 && hasWords(text, w));
    const because = street ?? name;
    if (because) hits.push({ job, because });
  }
  return hits.length === 1 ? hits[0] : null;
}

/** Where an inbox file is kept until it's filed: the company's own
 *  folder, named by its message so a retry overwrites nothing else. */
export function inboxPath(companyId: string, messageId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120);
  return `whatsapp-inbox/${companyId}/${messageId}-${safe}`;
}
