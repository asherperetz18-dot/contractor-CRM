import { normalizePhone, type Lead } from "./data/types.ts";

/**
 * The Contacts page's "possible duplicates" banner, as a pure grouping
 * over slim rows. It used to run in the browser against the whole book
 * -- possible only because every lead was shipped there. The judgments
 * are unchanged: grouped on the primary phone's last ten digits and on
 * the exact-lowercase email, exactly how the CSV importer warns on the
 * way in -- these are the ones that got in before that warning existed.
 */

export type DupContact = {
  id: string;
  contact_type: Lead["contact_type"];
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  stage: string;
  value: number;
};

export type DuplicateGroup = {
  key: string;
  kind: "phone" | "email";
  members: DupContact[];
};

export function buildDuplicateGroups(rows: DupContact[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const byPhone = new Map<string, DupContact[]>();
  const byEmail = new Map<string, DupContact[]>();
  for (const l of rows) {
    const p = l.phone ? normalizePhone(l.phone) : "";
    if (p.length === 10) byPhone.set(p, [...(byPhone.get(p) ?? []), l]);
    const e = (l.email ?? "").trim().toLowerCase();
    if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), l]);
  }
  for (const [key, members] of byPhone) if (members.length > 1) groups.push({ key, kind: "phone", members });
  // An email group that is just a phone group again adds noise, not
  // information -- only report it when it names somebody new.
  const inPhoneGroups = new Set(groups.flatMap((g) => g.members.map((m) => m.id)));
  for (const [key, members] of byEmail)
    if (members.length > 1 && members.some((m) => !inPhoneGroups.has(m.id)))
      groups.push({ key, kind: "email", members });
  return groups.sort((a, b) => b.members.length - a.members.length);
}
