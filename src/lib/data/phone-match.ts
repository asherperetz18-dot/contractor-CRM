/**
 * Who owns a phone number -- and whether that answer is certain.
 *
 * A plain module with no runtime imports so the rule can be tested
 * without a database; the database side is in
 * src/lib/data/lead-for-number.ts.
 *
 * The three answers are kept apart on purpose. The lookup used to
 * return one contact id or null, and null meant BOTH "nobody has this
 * number" and "several contacts have it". The CallRail importer read
 * null as "a caller we have never met" and made a new contact -- so the
 * moment a number sat on two cards, every later call from it made a
 * third, then a fourth. One caller landed three times in a single day
 * that way. "many" now says plainly that the number is already in the
 * book, so nothing new is created for it.
 */

/** The two columns a contact can be reached on. */
export type LeadPhoneRow = {
  id: string;
  phone: string | null;
  second_contact_phone: string | null;
};

export type PhoneMatch =
  | { kind: "none" }
  | { kind: "one"; leadId: string }
  | { kind: "many"; leadIds: string[] };

/**
 * The digits two numbers are compared on, or "" for anything too short
 * to be one. Same last-ten-digits rule as normalizePhone in types.ts --
 * repeated here rather than imported because a module with tests may
 * not pull the 100KB types file in at runtime; phone-match.test.ts
 * checks the two stay in step.
 *
 * Ten digits or nothing: a short or empty string would otherwise match
 * every contact whose phone field is blank.
 */
export function phoneKey(phone: string | null | undefined): string {
  const all = String(phone ?? "").replace(/\D/g, "");
  const digits = all.length > 10 ? all.slice(-10) : all;
  return digits.length >= 10 ? digits : "";
}

/**
 * Every contact keyed by each number they hold. Built once for a bulk
 * sweep -- rescanning the whole book per call timed a 90-day backfill
 * out.
 */
export function phoneIndex(rows: LeadPhoneRow[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const row of rows) {
    for (const raw of [row.phone, row.second_contact_phone]) {
      const key = phoneKey(raw);
      if (!key) continue;
      const ids = index.get(key);
      // One contact holding the same number in both columns is still
      // one contact, not an ambiguous pair.
      if (!ids) index.set(key, [row.id]);
      else if (!ids.includes(row.id)) ids.push(row.id);
    }
  }
  return index;
}

/** The answer for one number, read out of a prebuilt index. */
export function phoneMatchInIndex(
  index: Map<string, string[]>,
  phone: string | null | undefined
): PhoneMatch {
  const key = phoneKey(phone);
  if (!key) return { kind: "none" };
  const ids = index.get(key) ?? [];
  if (ids.length === 0) return { kind: "none" };
  if (ids.length === 1) return { kind: "one", leadId: ids[0] };
  return { kind: "many", leadIds: [...ids] };
}

/** The answer for one number against a list of contacts. */
export function phoneMatchIn(
  rows: LeadPhoneRow[],
  phone: string | null | undefined
): PhoneMatch {
  return phoneMatchInIndex(phoneIndex(rows), phone);
}

/** Adds a contact to an index mid-sweep, so the calls still to be read
 *  in the same run find them instead of making another copy. */
export function rememberInIndex(
  index: Map<string, string[]>,
  phone: string | null | undefined,
  leadId: string
): void {
  const key = phoneKey(phone);
  if (!key) return;
  const ids = index.get(key);
  if (!ids) index.set(key, [leadId]);
  else if (!ids.includes(leadId)) ids.push(leadId);
}

/**
 * The contact id only when exactly one contact owns the number. Callers
 * that just want "file this against someone, or nobody" keep using this
 * and are unaffected by the three-way answer.
 */
export function soleLeadId(match: PhoneMatch): string | null {
  return match.kind === "one" ? match.leadId : null;
}
