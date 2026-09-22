"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canViewFinancials } from "@/lib/data/accounting-access";
import { canViewEstimates, type PipelineStageRow } from "@/lib/data/types";
import {
  buildSearchGroups,
  ilikeAnyColumn,
  searchWords,
  type GlobalSearchGroup,
  type SearchableBill,
  type SearchableEstimate,
  type SearchableEvent,
  type SearchableLead,
  type SearchableNote,
} from "@/lib/data/global-search";

/**
 * The topbar's "Search for Anything". One query, matched against every
 * kind of record the person is allowed to see -- contacts, estimates and
 * contracts, appointments, notes, vendor bills -- returned in labelled
 * groups.
 *
 * The matching happens inside Postgres (the global_search function,
 * migration 0170): one round trip in, only matching rows out, with a
 * trigram index on a stored per-lead haystack so 79k contacts answer in
 * milliseconds. Its predecessor (0155) rebuilt every contact's haystack
 * on every search and took 3-8 seconds at that scale -- past the
 * statement timeout, which this action then reported as "No matches".
 *
 * Until 0170 is run in Supabase (migrations are pasted by hand and can
 * lag a deploy for days), and whenever the RPC fails for any reason, the
 * same search runs through PostgREST filters instead: one per-word ilike
 * chain per table, in parallel. Slower and it cannot match a client's
 * name onto their contract except through the contacts it found, but it
 * never hides a record the database has.
 *
 * Access mirrors the pages the hits link to: estimates only for people
 * canViewEstimates lets in, bills only for canViewFinancials -- a search
 * result naming a contract to someone barred from the estimates page
 * would itself be the leak. The SQL function is SECURITY INVOKER, so the
 * caller's own RLS applies to every table it reads as a backstop. Hit
 * shaping and the final matching rules live in lib/data/global-search so
 * they stay pinned by tests.
 *
 * Returns null when neither path could answer, so the topbar can say
 * "search failed" instead of "no matches".
 */

type GlobalSearchPayload = {
  leads: SearchableLead[];
  context_leads: SearchableLead[];
  estimates: SearchableEstimate[];
  events: SearchableEvent[];
  bills: SearchableBill[];
  notes: SearchableNote[];
  stages: Pick<PipelineStageRow, "name" | "color">[];
};

// One literal, not a concatenation: supabase-js types the rows off the
// select string, and a computed string types them as an error.
const LEAD_COLUMNS =
  "id, contact_type, company_name, first_name, last_name, phone, phone2, phone3, email, address, zip, second_contact_first_name, second_contact_last_name, second_contact_phone, second_contact_email, stage";
const LEAD_SEARCH_COLUMNS = [
  "first_name",
  "last_name",
  "company_name",
  "phone",
  "phone2",
  "phone3",
  "email",
  "address",
  "zip",
  "second_contact_first_name",
  "second_contact_last_name",
  "second_contact_phone",
  "second_contact_email",
];
const PER_KIND = 8;

// Whether leads.search_text exists, i.e. migration 0170 has been run.
// Probed once per server instance and remembered only when true: a
// column never goes away, but a missing one may be added any day.
let searchColumnPresent = false;

async function hasSearchColumn(supabase: Awaited<ReturnType<typeof createClient>>): Promise<boolean> {
  if (searchColumnPresent) return true;
  const { error } = await supabase.from("leads").select("search_text").limit(1);
  searchColumnPresent = !error;
  return searchColumnPresent;
}

export async function searchEverything(query: string): Promise<GlobalSearchGroup[] | null> {
  const q = query.trim();
  const words = searchWords(q);
  if (words.length === 0) return [];

  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await createClient();
  const includeDocs = canViewEstimates(profile);
  const includeBills = canViewFinancials(profile);

  let found: GlobalSearchPayload | null = null;
  if (await hasSearchColumn(supabase)) {
    const { data, error } = await supabase.rpc("global_search", {
      p_company: profile.company_id,
      p_query: q,
      p_include_docs: includeDocs,
      p_include_bills: includeBills,
    });
    if (error || !data) console.error("global_search failed, searching through filters instead", error);
    else found = data as GlobalSearchPayload;
  }
  if (!found) {
    found = await searchThroughFilters(supabase, profile.company_id, words, includeDocs, includeBills);
    if (!found) return null;
  }

  // context_leads are the clients of matched documents/appointments/
  // notes, fetched so those hits can show the client's name even when
  // the lead itself was not a contact match. Matched leads first, so
  // contact results keep their newest-first order.
  const leadById = new Map(found.leads.map((l) => [l.id, l] as const));
  for (const l of found.context_leads) {
    if (!leadById.has(l.id)) leadById.set(l.id, l);
  }

  return buildSearchGroups(q, {
    leads: [...leadById.values()],
    stages: found.stages,
    estimates: found.estimates,
    events: found.events,
    bills: found.bills,
    notes: found.notes,
  });
}

/**
 * The same search as PostgREST filters: every word must appear in one
 * of the row's columns. Contacts first, because documents and
 * appointments are also found through the contacts they belong to --
 * the "type a client's name, see their contract" rule the SQL function
 * applies with a join.
 */
async function searchThroughFilters(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  words: string[],
  includeDocs: boolean,
  includeBills: boolean
): Promise<GlobalSearchPayload | null> {
  const withWords = <T extends { or: (filter: string) => T }>(query: T, columns: string[]): T =>
    words.reduce((acc, w) => acc.or(ilikeAnyColumn(w, columns)), query);

  const leadsRes = await withWords(
    supabase.from("leads").select(LEAD_COLUMNS).eq("company_id", companyId),
    LEAD_SEARCH_COLUMNS
  )
    .order("created_at", { ascending: false })
    .limit(PER_KIND);
  if (leadsRes.error) {
    console.error("search fallback: leads", leadsRes.error);
    return null;
  }
  const leads = (leadsRes.data ?? []) as SearchableLead[];
  const leadIds = leads.map((l) => l.id);

  const byClient = <T extends { in: (col: string, ids: string[]) => T }>(query: T) =>
    leadIds.length > 0 ? query.in("lead_id", leadIds) : null;

  const estimateSelect = () =>
    supabase
      .from("estimates")
      .select("id, lead_id, doc_number, title, status, kind, job_address, total_cents")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(PER_KIND);
  const eventSelect = () =>
    supabase
      .from("events")
      .select("id, title, date, time, event_type, status, lead_id, notes")
      .eq("company_id", companyId)
      .order("date", { ascending: false })
      .limit(PER_KIND);

  const [estText, estClient, evText, evClient, notesRes, billsRes, stagesRes] = await Promise.all([
    includeDocs ? withWords(estimateSelect(), ["doc_number", "title", "job_address"]) : null,
    includeDocs ? byClient(estimateSelect()) : null,
    withWords(eventSelect(), ["title", "event_type", "notes"]),
    byClient(eventSelect()),
    withWords(supabase.from("lead_notes").select("id, lead_id, body, created_at"), ["body"])
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    includeBills
      ? withWords(
          supabase
            .from("vendor_bills")
            .select("id, vendor_name, reference, amount_cents, due_date, notes, voided_at")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .limit(PER_KIND),
          ["vendor_name", "reference", "notes"]
        )
      : null,
    supabase.from("pipeline_stages").select("name, color").eq("company_id", companyId),
  ]);

  for (const res of [estText, estClient, evText, evClient, notesRes, billsRes, stagesRes]) {
    if (res?.error) {
      console.error("search fallback", res.error);
      return null;
    }
  }

  const dedupe = <T extends { id: string }>(...lists: (T[] | null | undefined)[]): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const row of lists.flatMap((l) => l ?? [])) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
    return out;
  };

  const estimates = dedupe(
    estText?.data as SearchableEstimate[] | null,
    estClient?.data as SearchableEstimate[] | null
  );
  const events = dedupe(evText?.data as SearchableEvent[] | null, evClient?.data as SearchableEvent[] | null);
  const notes = (notesRes.data ?? []) as SearchableNote[];

  // Clients of the documents, appointments and notes found by their own
  // text, so those hits can be named.
  const contextIds = [
    ...new Set(
      [...estimates, ...events, ...notes]
        .map((r) => r.lead_id)
        .filter((id): id is string => !!id && !leadIds.includes(id))
    ),
  ];
  let context_leads: SearchableLead[] = [];
  if (contextIds.length > 0) {
    const { data, error } = await supabase.from("leads").select(LEAD_COLUMNS).in("id", contextIds);
    if (error) {
      console.error("search fallback: context leads", error);
      return null;
    }
    context_leads = (data ?? []) as SearchableLead[];
  }

  return {
    leads,
    context_leads,
    estimates,
    events,
    notes,
    bills: (billsRes?.data ?? []) as SearchableBill[],
    stages: (stagesRes.data ?? []) as Pick<PipelineStageRow, "name" | "color">[],
  };
}
