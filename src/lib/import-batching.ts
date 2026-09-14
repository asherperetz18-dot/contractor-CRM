// Relative rather than the "@/" alias so `node --test` can run the
// .test.ts beside this file without a resolver.
import { normalizePhone } from "./data/types.ts";

/**
 * Pure core of the CSV lead import at spreadsheet scale.
 *
 * A 73k-row file cannot travel as one server-action call: Vercel caps a
 * serverless request body at 4.5MB regardless of Next's own
 * `bodySizeLimit`, and one invocation doing 148 sequential inserts
 * outlives the function timeout. So the browser slices the upload into
 * chunks (`chunkRows`) and sends them one call at a time -- and the
 * duplicate scan flips direction: instead of shipping the whole
 * spreadsheet up, the server sends down every existing contact's
 * phone/email keys once (`collectContactKeys`, over a paginated select)
 * and the rows are matched here (`matchDuplicateIndexes`).
 */

// ~0.5KB per mapped row keeps a chunk around 1MB -- well under the
// 4.5MB cap even for note-heavy rows, and only a few inserts of work
// per call on the server.
export const IMPORT_CHUNK_ROWS = 2000;

export type ImportRowKeys = {
  phone: string;
  phone2?: string;
  phone3?: string;
  email: string;
};

export type ExistingContactKeys = { phones: string[]; emails: string[] };

export function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

/**
 * Phones normalised to their last 10 digits (so formatting differences
 * don't hide a match) and emails lowercased, from every slot a lead can
 * hold a contact point in. Blank slots are dropped -- an empty key
 * would "match" every row that also left that field blank.
 */
export function collectContactKeys(
  rows: {
    phone: string | null;
    phone2: string | null;
    phone3: string | null;
    email: string | null;
    second_contact_phone: string | null;
  }[]
): ExistingContactKeys {
  const phones = new Set<string>();
  const emails = new Set<string>();
  for (const r of rows) {
    for (const p of [r.phone, r.phone2, r.phone3, r.second_contact_phone]) {
      if (p) {
        const n = normalizePhone(p);
        if (n) phones.add(n);
      }
    }
    const e = r.email?.trim().toLowerCase();
    if (e) emails.add(e);
  }
  return { phones: [...phones], emails: [...emails] };
}

/** Which rows already exist, by index, matched on any phone slot or email. */
export function matchDuplicateIndexes(
  rows: ImportRowKeys[],
  existing: ExistingContactKeys
): number[] {
  const phones = new Set(existing.phones);
  const emails = new Set(existing.emails);
  const indexes: number[] = [];
  rows.forEach((r, i) => {
    const rowPhones = [r.phone, r.phone2, r.phone3]
      .map((p) => (p ? normalizePhone(p) : ""))
      .filter(Boolean);
    const e = r.email ? r.email.trim().toLowerCase() : "";
    if (rowPhones.some((p) => phones.has(p)) || (e && emails.has(e))) {
      indexes.push(i);
    }
  });
  return indexes;
}
