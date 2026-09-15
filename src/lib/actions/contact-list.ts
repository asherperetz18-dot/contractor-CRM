"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import { digitsSearchPattern } from "@/lib/dial-filters";
import { buildDuplicateGroups, type DupContact, type DuplicateGroup } from "@/lib/contact-duplicates";
import { leadDisplayName } from "@/lib/data/types";
import type { Lead } from "@/lib/data/types";

/**
 * The Contacts page's server side -- same cure as the Power Dialer and
 * the pipeline board (DECISIONS #019/#020): the browser gets the rows
 * on screen and the numbers, never the book. Search runs here; the
 * duplicate banner's grouping runs here; a contact's card data is
 * fetched when opened (getLeadCard in pipeline-board.ts).
 */

export type ContactListRow = {
  id: string;
  contact_type: Lead["contact_type"];
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  address: string | null;
  phone: string | null;
  source: string | null;
  assigned_to: string | null;
  stage: string;
  value: number;
};

const ROW_COLUMNS =
  "id, contact_type, company_name, first_name, last_name, email, address, phone, source, assigned_to, stage, value";

/** "Select all matching" stops here: selection exists to feed a bulk
 *  email, and a bulk send to more than this is a different feature (and
 *  probably a mistake), not a bigger checkbox. */
const SELECT_ALL_CAP = 2000;

/** At most this many duplicate groups travel; the count is still exact. */
const DUP_GROUP_CAP = 100;

function escapeLike(q: string): string {
  return q.replace(/[%_]/g, (c) => `\\${c}`);
}

function searchClause(search: string): string | null {
  const q = search.trim();
  if (!q) return null;
  const term = `%${escapeLike(q)}%`;
  const parts = [
    `first_name.ilike.${term}`,
    `last_name.ilike.${term}`,
    `company_name.ilike.${term}`,
    `email.ilike.${term}`,
    `address.ilike.${term}`,
    `phone.ilike.${term}`,
  ];
  const digits = digitsSearchPattern(q);
  if (digits) parts.push(`phone.ilike.${digits}`);
  return parts.join(",");
}

export async function listContacts(input: {
  search: string;
  offset: number;
  limit: number;
}): Promise<{ rows: ContactListRow[]; total: number }> {
  const profile = await getCurrentProfile();
  if (!profile) return { rows: [], total: 0 };
  const supabase = await createClient();

  let q = supabase
    .from("leads")
    .select(ROW_COLUMNS, { count: "exact" })
    .eq("company_id", profile.company_id);
  const or = searchClause(input.search);
  if (or) q = q.or(or);
  const { data, count, error } = await q
    .order("created_at", { ascending: false })
    .range(input.offset, input.offset + Math.min(input.limit, 200) - 1);
  if (error) return { rows: [], total: 0 };
  return { rows: (data ?? []) as ContactListRow[], total: count ?? 0 };
}

/** The three stat tiles, as head counts -- no rows travel. */
export async function getContactStats(): Promise<{
  totalContacts: number;
  withOpenLeads: number;
  noSetterAssigned: number;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { totalContacts: 0, withOpenLeads: 0, noSetterAssigned: 0 };
  const supabase = await createClient();
  const base = () =>
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("company_id", profile.company_id);
  const [total, open, unassigned] = await Promise.all([
    base(),
    base().not("stage", "in", "(Won,Lost,DNC)"),
    base().is("assigned_to", null),
  ]);
  return {
    totalContacts: total.count ?? 0,
    withOpenLeads: open.count ?? 0,
    noSetterAssigned: unassigned.count ?? 0,
  };
}

/**
 * The duplicate banner's groups, grouped here from a slim scan of the
 * book (see src/lib/contact-duplicates.ts and its tests). Called after
 * first paint so the page never waits on it. Capped: reviewing happens
 * one group at a time, and after a big import the full list can be
 * thousands of groups long -- the count says how deep the water is.
 */
export async function getContactDuplicateGroups(): Promise<{
  groups: DuplicateGroup[];
  totalGroups: number;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { groups: [], totalGroups: 0 };
  const supabase = await createClient();
  const rows = await selectAll<DupContact>((f, t) =>
    supabase
      .from("leads")
      .select("id, contact_type, company_name, first_name, last_name, phone, email, stage, value")
      .eq("company_id", profile.company_id)
      // Ordered so the pager's pages can't overlap or skip.
      .order("created_at", { ascending: false })
      .range(f, t)
  );
  const groups = buildDuplicateGroups(rows);
  return { groups: groups.slice(0, DUP_GROUP_CAP), totalGroups: groups.length };
}

/**
 * Everything the current search matches, as bulk-email recipients --
 * "select all" must mean the whole match, not the rows scrolled into
 * view. Capped, and says when it capped.
 */
export async function listMatchingRecipients(search: string): Promise<{
  recipients: { id: string; name: string; email: string | null }[];
  total: number;
  capped: boolean;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { recipients: [], total: 0, capped: false };
  const supabase = await createClient();

  let q = supabase
    .from("leads")
    .select("id, contact_type, company_name, first_name, last_name, email", { count: "exact" })
    .eq("company_id", profile.company_id);
  const or = searchClause(search);
  if (or) q = q.or(or);
  const { data, count } = await q
    .order("created_at", { ascending: false })
    .range(0, SELECT_ALL_CAP - 1);

  const rows = (data ?? []) as (Pick<
    Lead,
    "id" | "contact_type" | "company_name" | "first_name" | "last_name" | "email"
  >)[];
  const total = count ?? rows.length;
  return {
    recipients: rows.map((l) => ({ id: l.id, name: leadDisplayName(l), email: l.email })),
    total,
    capped: total > rows.length,
  };
}
