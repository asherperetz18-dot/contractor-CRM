"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canViewFinancials } from "@/lib/data/accounting-access";
import { selectAll } from "@/lib/data/select-all";
import { canViewEstimates, type PipelineStageRow } from "@/lib/data/types";
import {
  buildSearchGroups,
  type GlobalSearchGroup,
  type SearchableBill,
  type SearchableEstimate,
  type SearchableEvent,
  type SearchableLead,
} from "@/lib/data/global-search";

/**
 * The topbar's "Search for Anything". One query, matched against every
 * kind of record the person is allowed to see -- contacts, estimates and
 * contracts, appointments, vendor bills -- returned in labelled groups.
 *
 * Access mirrors the pages the hits link to: estimates only for people
 * canViewEstimates lets in, bills only for canViewFinancials -- a search
 * result naming a contract to someone barred from the estimates page
 * would itself be the leak. Matching and hit shaping live in
 * lib/data/global-search so the rules are pinned by tests.
 */
export async function searchEverything(query: string): Promise<GlobalSearchGroup[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const profile = await getCurrentProfile();
  if (!profile) return [];
  const companyId = profile.company_id;

  const supabase = await createClient();

  const showDocs = canViewEstimates(profile);
  const showBills = canViewFinancials(profile);

  // Paged. A plain select stops at PostgREST's 1000-row ceiling with no
  // error, so search was reading the 1000 newest contacts and quietly
  // ignoring the other 506 -- a third of the database that could not be
  // found by name, phone or address no matter what you typed.
  const [leads, { data: stages }, estimates, events, bills] = await Promise.all([
    selectAll<SearchableLead>((from, to) =>
      supabase
        .from("leads")
        .select(
          "id, contact_type, company_name, first_name, last_name, phone, email, address, stage"
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .range(from, to)
    ),
    supabase.from("pipeline_stages").select("name, color").eq("company_id", companyId),
    showDocs
      ? selectAll<SearchableEstimate>((from, to) =>
          supabase
            .from("estimates")
            .select("id, lead_id, doc_number, title, status, kind, job_address, total_cents")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .range(from, to)
        )
      : Promise.resolve([]),
    selectAll<SearchableEvent>((from, to) =>
      supabase
        .from("events")
        .select("id, title, date, time, event_type, status, lead_id, notes")
        .eq("company_id", companyId)
        .order("date", { ascending: false })
        .range(from, to)
    ),
    showBills
      ? selectAll<SearchableBill>((from, to) =>
          supabase
            .from("vendor_bills")
            .select("id, vendor_name, reference, amount_cents, due_date, notes, voided_at")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .range(from, to)
        )
      : Promise.resolve([]),
  ]);

  return buildSearchGroups(q, {
    leads,
    stages: (stages as Pick<PipelineStageRow, "name" | "color">[]) ?? [],
    estimates,
    events,
    bills,
  });
}
