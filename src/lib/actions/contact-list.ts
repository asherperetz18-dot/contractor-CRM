"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import { digitsSearchPattern } from "@/lib/dial-filters";
import { buildDuplicateGroups, type DupContact, type DuplicateGroup } from "@/lib/contact-duplicates";
import { leadDisplayName } from "@/lib/data/types";
import {
  contactFilterClauses,
  hasContactFilters,
  parseContactFilters,
  type ContactFilters,
} from "@/lib/contact-filters";
import type { Lead } from "@/lib/data/types";
import { OPEN_LEADS_FILTER } from "@/lib/pipeline/stage-keys";
import { getBoughtListKeysCached } from "@/lib/data/company-chrome";
import { notALeadPattern } from "@/lib/lead-or-contact";

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

/** Leads only, resolved: the company's bought-list sources as a filter
 *  pattern (DECISIONS #156), or null when the filter is off. */
async function leadsOnlyPattern(filters: unknown, companyId: string): Promise<string | null> {
  if (!parseContactFilters(filters).leadsOnly) return null;
  return notALeadPattern(await getBoughtListKeysCached(companyId));
}

/**
 * The search box and the Source / Rep / Stage / Leads only filters, on
 * any leads query. `filters` comes from the browser, so it is re-parsed
 * here; `notALead` is leadsOnlyPattern's answer.
 */
function narrow<Q extends { or(filters: string): Q; not(column: string, operator: string, value: unknown): Q }>(
  q: Q,
  search: string,
  filters: unknown,
  notALead: string | null
): Q {
  const or = searchClause(search);
  if (or) q = q.or(or);
  for (const clause of contactFilterClauses(parseContactFilters(filters))) q = q.or(clause);
  if (notALead !== null) q = q.not("source", "imatch", notALead);
  return q;
}

export async function listContacts(input: {
  search: string;
  filters?: ContactFilters;
  offset: number;
  limit: number;
}): Promise<{ rows: ContactListRow[]; total: number }> {
  const profile = await getCurrentProfile();
  if (!profile) return { rows: [], total: 0 };
  const supabase = await createClient();

  const q = narrow(
    supabase.from("leads").select(ROW_COLUMNS, { count: "exact" }).eq("company_id", profile.company_id),
    input.search,
    input.filters,
    await leadsOnlyPattern(input.filters, profile.company_id)
  );
  const { data, count, error } = await q
    .order("created_at", { ascending: false })
    .range(input.offset, input.offset + Math.min(input.limit, 200) - 1);
  if (error) return { rows: [], total: 0 };
  return { rows: (data ?? []) as ContactListRow[], total: count ?? 0 };
}

/**
 * The three stat tiles, as head counts -- no rows travel. They follow
 * the search and filters, so the numbers above the table describe the
 * table. `bookTotal` is the unfiltered count, for "N of 6,743".
 */
export async function getContactStats(input?: { search?: string; filters?: ContactFilters }): Promise<{
  totalContacts: number;
  withOpenLeads: number;
  noSetterAssigned: number;
  bookTotal: number;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { totalContacts: 0, withOpenLeads: 0, noSetterAssigned: 0, bookTotal: 0 };
  const supabase = await createClient();
  const search = input?.search ?? "";
  const filters = parseContactFilters(input?.filters);
  const narrowed = search.trim() !== "" || hasContactFilters(filters);
  const book = () =>
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("company_id", profile.company_id);
  const notALead = await leadsOnlyPattern(filters, profile.company_id);
  const base = () => narrow(book(), search, filters, notALead);
  const [total, open, unassigned, whole] = await Promise.all([
    base(),
    base().or(OPEN_LEADS_FILTER),
    base().is("assigned_to", null),
    narrowed ? book() : null,
  ]);
  return {
    totalContacts: total.count ?? 0,
    withOpenLeads: open.count ?? 0,
    noSetterAssigned: unassigned.count ?? 0,
    bookTotal: (whole ?? total).count ?? 0,
  };
}

/**
 * The values contacts actually carry, for the filter dropdowns (0184).
 * Until that migration has run the function is missing and every list
 * comes back empty -- the page then offers the Settings lists and the
 * Sales reps alone.
 */
export async function getContactFilterFacets(): Promise<{
  sources: string[];
  reps: string[];
  stages: string[];
}> {
  const empty = { sources: [], reps: [], stages: [] };
  const profile = await getCurrentProfile();
  if (!profile) return empty;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contact_filter_facets", { p_company: profile.company_id });
  if (error || !data) return empty;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const d = data as Record<string, unknown>;
  return { sources: list(d.sources), reps: list(d.reps), stages: list(d.stages) };
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
 * Everything the current search and filters match, as bulk-email recipients --
 * "select all" must mean the whole match, not the rows scrolled into
 * view. Capped, and says when it capped.
 */
export async function listMatchingRecipients(
  search: string,
  filters?: ContactFilters
): Promise<{
  recipients: { id: string; name: string; email: string | null }[];
  total: number;
  capped: boolean;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { recipients: [], total: 0, capped: false };
  const supabase = await createClient();

  const q = narrow(
    supabase
      .from("leads")
      .select("id, contact_type, company_name, first_name, last_name, email", { count: "exact" })
      .eq("company_id", profile.company_id),
    search,
    filters,
    await leadsOnlyPattern(filters, profile.company_id)
  );
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
