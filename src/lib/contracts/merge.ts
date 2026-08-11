/**
 * Filling a contract template with the facts of one job.
 *
 * A plain module on purpose: "use server" files may only export async
 * functions, and both the settings editor (client) and estimate creation
 * (server) need these. The editor shows the token list, the server does
 * the substitution, and neither should be describing the tokens
 * separately from the code that resolves them.
 */

import { depositCents, moneyCents } from "@/lib/data/types";

export type MergeField = {
  token: string;
  label: string;
  /** What it looks like, so the editor's help is concrete. */
  example: string;
};

/**
 * Every token a contract may use.
 *
 * Deliberately a fixed list rather than "any column". A contract is a
 * legal document, and a template that can reach arbitrary data is a
 * template nobody can review.
 */
export const MERGE_FIELDS: MergeField[] = [
  { token: "contract_no", label: "Contract / CRM record number", example: "EST-1012" },
  { token: "contract_date", label: "Date the contract was prepared", example: "August 11, 2026" },
  { token: "client_name", label: "Client full name", example: "Natanel Test" },
  { token: "client_phone", label: "Client phone", example: "(818) 651-1997" },
  { token: "client_email", label: "Client email", example: "client@example.com" },
  { token: "project_address", label: "Project address", example: "14333 Collins St, Sherman Oaks, CA" },
  { token: "contract_total", label: "Total contract price", example: "$5,400.00" },
  { token: "deposit_amount", label: "Deposit due at signing", example: "$540.00" },
  { token: "start_date", label: "Approximate start date", example: "September 2, 2026" },
  { token: "completion_date", label: "Estimated completion date", example: "September 20, 2026" },
  { token: "rep_name", label: "Sales representative", example: "Asher Peretz" },
  { token: "project_title", label: "Project title", example: "New roof" },
  { token: "company_name", label: "Your company name", example: "L.A. Home Contractor Inc." },
  { token: "company_address", label: "Your company address", example: "22221 Pacific Coast Hwy, Malibu, CA" },
  { token: "company_phone", label: "Your company phone", example: "(818) 717-7714" },
  { token: "company_email", label: "Your company email", example: "info@lahomecontractor.com" },
  { token: "license_no", label: "Your contractor licence number", example: "1027193" },
];

export type MergeValues = Partial<Record<string, string | null>>;

/**
 * Substitutes {{token}} throughout the body.
 *
 * An unknown or empty token is left standing as written rather than
 * replaced with a blank or the word "undefined". A contract with
 * "{{client_name}}" printed on it is obviously unfinished; one with an
 * empty space where the name should be looks finished and is not, and
 * that is the version somebody signs.
 */
export function fillContract(body: string, values: MergeValues): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, rawToken: string) => {
    const value = values[rawToken.toLowerCase()];
    return value != null && String(value).trim() !== "" ? String(value) : whole;
  });
}

/** Which tokens a body actually uses -- for the editor's live check. */
export function tokensUsed(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) found.add(m[1].toLowerCase());
  return [...found];
}

/** Tokens the template asks for that this system cannot supply. */
export function unknownTokens(body: string): string[] {
  const known = new Set(MERGE_FIELDS.map((f) => f.token));
  return tokensUsed(body).filter((t) => !known.has(t));
}

/**
 * The fields that cannot be known when an estimate is created.
 *
 * Nothing is priced or scheduled at that moment, so these resolve later:
 * frozen into the stored text when the estimate is sent, and substituted
 * at render time before that, so a draft preview shows real figures
 * instead of braces. One function for both, because a preview computed
 * differently from the document is a preview that can lie.
 */
export function lateContractValues(e: {
  total_cents: number;
  deposit_cents: number | null;
  deposit_percent_bp: number;
  deposit_cap_cents: number;
  start_date?: string | null;
  completion_date?: string | null;
}): MergeValues {
  const day = (d?: string | null) =>
    d
      ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : null;
  return {
    contract_total: moneyCents(e.total_cents),
    deposit_amount: moneyCents(
      e.deposit_cents ?? depositCents(e.total_cents, e.deposit_percent_bp, e.deposit_cap_cents)
    ),
    start_date: day(e.start_date),
    completion_date: day(e.completion_date),
  };
}

export type ContractBlock =
  | { kind: "heading"; text: string }
  | { kind: "bullet"; items: string[] }
  | { kind: "paragraph"; text: string };

/**
 * Turns pasted contract text into blocks a document can render.
 *
 * These are written in Word and pasted in, so the input is plain text
 * with blank lines between paragraphs -- not markdown, and definitely not
 * HTML, which is why nothing here interprets tags. A numbered section
 * head ("12. Right to Cancel") is short and starts with a number, which
 * is enough to tell it from a sentence that merely begins with one.
 */
export function parseContract(body: string): ContractBlock[] {
  const blocks: ContractBlock[] = [];
  for (const chunk of body.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    for (const line of lines) {
      const isHeading = /^\d{1,2}[.)]\s+\S/.test(line) && line.length <= 80 && !/[.!?]$/.test(line);
      if (isHeading) {
        blocks.push({ kind: "heading", text: line });
        continue;
      }
      const bulletMatch = /^[-•*]\s+(.*)$/.exec(line);
      if (bulletMatch) {
        const last = blocks[blocks.length - 1];
        if (last?.kind === "bullet") last.items.push(bulletMatch[1]);
        else blocks.push({ kind: "bullet", items: [bulletMatch[1]] });
        continue;
      }
      const last = blocks[blocks.length - 1];
      // Consecutive non-blank lines inside one chunk are one paragraph
      // that Word happened to wrap, not separate thoughts.
      if (last?.kind === "paragraph") last.text += " " + line;
      else blocks.push({ kind: "paragraph", text: line });
    }
    // A blank line ends whatever was being accumulated.
    blocks.push({ kind: "paragraph", text: "" });
  }
  return blocks.filter((b) => b.kind !== "paragraph" || b.text.trim() !== "");
}
