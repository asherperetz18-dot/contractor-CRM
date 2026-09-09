"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canViewFinancials } from "@/lib/data/accounting-access";
import { canViewEstimates, type PipelineStageRow } from "@/lib/data/types";
import {
  buildSearchGroups,
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
 * migration 0140): one round trip in, only matching rows out. It used to
 * happen here instead, by downloading EVERY row of every searched table
 * in 1000-row pages -- 6,500+ contacts alone -- which made each search
 * take seconds.
 *
 * Access mirrors the pages the hits link to: estimates only for people
 * canViewEstimates lets in, bills only for canViewFinancials -- a search
 * result naming a contract to someone barred from the estimates page
 * would itself be the leak. The SQL function is SECURITY INVOKER, so the
 * caller's own RLS applies to every table it reads as a backstop. Hit
 * shaping and the final matching rules live in lib/data/global-search so
 * they stay pinned by tests.
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

export async function searchEverything(query: string): Promise<GlobalSearchGroup[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("global_search", {
    p_company: profile.company_id,
    p_query: q,
    p_include_docs: canViewEstimates(profile),
    p_include_bills: canViewFinancials(profile),
  });
  if (error || !data) {
    console.error("global_search failed", error);
    return [];
  }
  const found = data as GlobalSearchPayload;

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
