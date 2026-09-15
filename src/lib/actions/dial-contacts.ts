"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import {
  buildCallStats,
  calledFilterPlan,
  contactQueryPlan,
  digitsSearchPattern,
} from "@/lib/dial-filters";
import { normalizePhone, type Lead } from "@/lib/data/types";
import { summarizeLeadCalls, type LeadCallInfo } from "@/lib/lead-call-info";
import {
  DIAL_PAGE_SIZE,
  type DialContactPage,
  type DialContactQuery,
  type DialContactRow,
} from "@/lib/dial-filters";

/**
 * The Power Dialer's server side.
 *
 * The dial queue page used to ship every lead in the company (all
 * columns, notes included) plus every call log to the browser and
 * filter there -- at 79k contacts that was a payload in the tens of
 * megabytes and a page that took ages to open. These actions follow the
 * searchBookableLeads precedent instead: the page gets the 50 rows it
 * displays and a total, and every filter change asks the server again.
 * Full Lead rows travel only for the contacts a rep actually selected.
 */

const ROW_COLUMNS =
  "id, contact_type, company_name, first_name, last_name, phone, project_type, stage, assigned_to, address_type, created_at";

/** PostgREST puts an .in() list in the request; keep each one bounded. */
const IN_CHUNK = 150;

/**
 * The slice of the Supabase query builder this module uses, named
 * structurally: the full generated builder type is deep enough that a
 * generic over it trips TS2589, and nothing here needs it -- one cast
 * at each from().select() and every query flows through the same
 * applyBaseFilters, so the page, the count, and the exclusion
 * arithmetic all describe the same set of rows.
 */
type LeadsQuery = {
  eq(column: string, value: unknown): LeadsQuery;
  neq(column: string, value: unknown): LeadsQuery;
  not(column: string, operator: string, value: unknown): LeadsQuery;
  or(clause: string): LeadsQuery;
  gte(column: string, value: unknown): LeadsQuery;
  in(column: string, values: unknown[]): LeadsQuery;
  order(column: string, opts: { ascending: boolean }): LeadsQuery;
  range(from: number, to: number): LeadsQuery;
  then<R>(
    onfulfilled: (value: {
      data: unknown[] | null;
      count: number | null;
      error: { message: string } | null;
    }) => R
  ): PromiseLike<R>;
};

function escapeLike(q: string): string {
  return q.replace(/[%_]/g, (c) => `\\${c}`);
}

/** Name/phone search as one PostgREST or() clause; null = no search. */
function searchClause(search: string): string | null {
  const q = search.trim();
  if (!q) return null;
  const term = `%${escapeLike(q)}%`;
  const parts = [
    `first_name.ilike.${term}`,
    `last_name.ilike.${term}`,
    `company_name.ilike.${term}`,
    `phone.ilike.${term}`,
  ];
  const digits = digitsSearchPattern(q);
  if (digits) parts.push(`phone.ilike.${digits}`);
  return parts.join(",");
}

export async function listDialContacts(input: DialContactQuery): Promise<DialContactPage> {
  const profile = await getCurrentProfile();
  if (!profile) return { rows: [], total: 0 };
  const companyId = profile.company_id;
  const supabase = await createClient();

  const page = Math.max(1, Math.floor(input.page));
  const offset = (page - 1) * DIAL_PAGE_SIZE;
  const or = searchClause(input.search);

  // Filters shared by every query this function issues, so the page,
  // the total, and the exclusion arithmetic agree on what "matches".
  function applyBaseFilters(q: LeadsQuery): LeadsQuery {
    let out = q.eq("company_id", companyId).not("phone", "is", null).neq("phone", "");
    if (or) out = out.or(or);
    if (input.tab === "contact") {
      if (input.addressTypeFilter !== "All") out = out.eq("address_type", input.addressTypeFilter);
    } else {
      if (input.statusFilter === "Won") out = out.eq("stage", "Won");
      if (input.statusFilter === "Lost") out = out.eq("stage", "Lost");
      if (input.statusFilter === "Open") out = out.not("stage", "in", "(Won,Lost)");
      if (input.stageFilter !== "All") out = out.eq("stage", input.stageFilter);
      if (input.repFilter !== "All") out = out.eq("assigned_to", input.repFilter);
      if (input.createdSince) out = out.gte("created_at", input.createdSince);
    }
    return out;
  }

  // The By Lead tab without a call-status pick maps straight onto one
  // paged query.
  if (input.tab === "lead" && input.calledFilter === "All") {
    const { data, count, error } = await applyBaseFilters(
      supabase.from("leads").select(ROW_COLUMNS, { count: "exact" }) as unknown as LeadsQuery
    )
      .order("created_at", { ascending: false })
      .range(offset, offset + DIAL_PAGE_SIZE - 1);
    if (error) return { rows: [], total: 0 };
    return { rows: (data ?? []) as DialContactRow[], total: count ?? 0 };
  }

  // Both remaining paths hinge on the *called* leads, a small set next
  // to the whole book. Reduce the filter combination to a plan: a small
  // id list to include, or to exclude from everyone the filters accept.
  let plan;
  if (input.tab === "lead") {
    // Call status on By Lead: who we actually dialed (outbound only --
    // a customer calling us is not us having called them).
    const dialed = await selectAll<{ lead_id: string | null }>((f, t) =>
      supabase
        .from("call_logs")
        .select("lead_id")
        .eq("company_id", companyId)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .range(f, t)
    );
    plan = calledFilterPlan(dialed.map((d) => d.lead_id), input.calledFilter as "Never" | "Called");
  } else {
    const logs = await selectAll<{ lead_id: string | null; disposition: string }>((f, t) =>
      supabase
        .from("call_logs")
        .select("lead_id, disposition")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .range(f, t)
    );
    plan = contactQueryPlan(buildCallStats(logs), input.callAttempts, input.dispositionFilter);
  }

  if (plan.mode === "include") {
    // Only these called leads can match: fetch them (chunked), keep the
    // ones the base filters accept, and page the merged list here.
    const rows: DialContactRow[] = [];
    for (let i = 0; i < plan.ids.length; i += IN_CHUNK) {
      const chunk = plan.ids.slice(i, i + IN_CHUNK);
      const { data } = await applyBaseFilters(
        supabase.from("leads").select(ROW_COLUMNS) as unknown as LeadsQuery
      ).in("id", chunk);
      rows.push(...((data ?? []) as DialContactRow[]));
    }
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { rows: rows.slice(offset, offset + DIAL_PAGE_SIZE), total: rows.length };
  }

  // Exclusion: everyone with a phone except a small id list. The total
  // is base-count minus how many excluded ids the base filters accept --
  // both sides described by the same applyBaseFilters.
  const { count } = await applyBaseFilters(
    supabase.from("leads").select("id", { count: "exact", head: true }) as unknown as LeadsQuery
  );
  let excludedMatching = 0;
  const excluded = new Set(plan.ids);
  for (let i = 0; i < plan.ids.length; i += IN_CHUNK) {
    const chunk = plan.ids.slice(i, i + IN_CHUNK);
    const { count: c } = await applyBaseFilters(
      supabase.from("leads").select("id", { count: "exact", head: true }) as unknown as LeadsQuery
    ).in("id", chunk);
    excludedMatching += c ?? 0;
  }
  const total = Math.max(0, (count ?? 0) - excludedMatching);

  // Scan forward in database order, dropping excluded ids, until this
  // page is filled. Page one -- the load that was slow -- is almost
  // always a single range read.
  const rows: DialContactRow[] = [];
  let skipped = 0;
  const SCAN = 1000;
  for (let from = 0; rows.length < DIAL_PAGE_SIZE && from < 100000; from += SCAN) {
    const { data, error } = await applyBaseFilters(
      supabase.from("leads").select(ROW_COLUMNS) as unknown as LeadsQuery
    )
      .order("created_at", { ascending: false })
      .range(from, from + SCAN - 1);
    if (error) break;
    const batch = (data ?? []) as DialContactRow[];
    for (const row of batch) {
      if (excluded.has(row.id)) continue;
      if (skipped < offset) {
        skipped += 1;
        continue;
      }
      rows.push(row);
      if (rows.length >= DIAL_PAGE_SIZE) break;
    }
    if (batch.length < SCAN) break;
  }
  return { rows, total };
}

/**
 * Everything a dial session starts with: the full Lead rows for the
 * selected contacts (the session works the real card -- quick-edit
 * fields, the maps link), in the order the rep queued them, plus each
 * lead's call recency so the session can warn "already called today"
 * and pause auto-dial instead of ringing the same person twice in an
 * afternoon. `sinceIso` is the rep's local midnight, computed in the
 * browser so "today" means their calendar day.
 */
export async function getDialSessionLeads(
  ids: string[],
  sinceIso: string
): Promise<{ leads: Lead[]; callInfo: Record<string, LeadCallInfo> }> {
  const profile = await getCurrentProfile();
  if (!profile || ids.length === 0) return { leads: [], callInfo: {} };
  const supabase = await createClient();

  const rows: Lead[] = [];
  const logRows: { lead_id: string | null; created_at: string }[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const [{ data }, { data: logs }] = await Promise.all([
      supabase
        .from("leads")
        .select("*")
        .eq("company_id", profile.company_id)
        .in("id", chunk),
      // Bounded to the rep's day: an unbounded read is silently capped
      // at 1000 rows by PostgREST, and the warning only ever shows
      // calls since sinceIso anyway.
      supabase
        .from("call_logs")
        .select("lead_id, created_at")
        .eq("company_id", profile.company_id)
        .eq("direction", "outbound")
        .gte("created_at", sinceIso)
        .in("lead_id", chunk),
    ]);
    rows.push(...((data ?? []) as Lead[]));
    logRows.push(...((logs ?? []) as { lead_id: string | null; created_at: string }[]));
  }

  // The queue dials in the order the rep built it, not table order.
  const position = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));

  return { leads: rows, callInfo: Object.fromEntries(summarizeLeadCalls(logRows, sinceIso)) };
}

/**
 * Which existing contacts a CSV of phone numbers belongs to. The
 * matching used to happen in the browser against an index of every
 * lead's phones -- possible only because the page had shipped them all.
 * Now the normalized keys travel up (bounded by the CSV) and the walk
 * over the book happens server-side; only matches come back.
 */
export async function matchDialCsvPhones(
  keys: string[]
): Promise<{ key: string; leadId: string }[]> {
  const profile = await getCurrentProfile();
  if (!profile || keys.length === 0) return [];
  const supabase = await createClient();

  const wanted = new Set(keys.filter((k) => k.length > 0));
  if (wanted.size === 0) return [];

  const leads = await selectAll<{
    id: string;
    phone: string | null;
    phone2: string | null;
    phone3: string | null;
    second_contact_phone: string | null;
  }>((f, t) =>
    supabase
      .from("leads")
      .select("id, phone, phone2, phone3, second_contact_phone")
      .eq("company_id", profile.company_id)
      .order("created_at", { ascending: false })
      .range(f, t)
  );

  const matches: { key: string; leadId: string }[] = [];
  const seen = new Set<string>();
  for (const l of leads) {
    for (const raw of [l.phone, l.phone2, l.phone3, l.second_contact_phone]) {
      if (!raw) continue;
      const key = normalizePhone(raw);
      if (wanted.has(key) && !seen.has(key)) {
        seen.add(key);
        matches.push({ key, leadId: l.id });
      }
    }
  }
  return matches;
}
