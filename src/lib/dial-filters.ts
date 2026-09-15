import { NO_DISPOSITION, type CallAttemptsFilter } from "./data/types.ts";

/**
 * The Power Dialer's contact filters, as query plans instead of an
 * in-browser array scan.
 *
 * The dial queue used to ship every lead in the company to the browser
 * and filter there; at 79k contacts the page took ages to open. The
 * insight that makes a server-side version cheap: attempts and
 * disposition are facts about *called* leads, and the set of called
 * leads (from call_logs) is small next to the whole book. So any
 * attempts+disposition combination reduces to either a small id list to
 * include, or a small id list to exclude from everyone-with-a-phone.
 */

export type CallStats = { attempts: number; disposition: string };

/** Just what the queue table renders -- never the 40-column Lead row. */
export type DialContactRow = {
  id: string;
  contact_type: "Individual" | "Company";
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  project_type: string | null;
  stage: string;
  assigned_to: string | null;
  address_type: string;
  created_at: string;
};

export const DIAL_PAGE_SIZE = 50;

export type LeadCalledFilter = "All" | "Never" | "Called";

export type DialContactQuery = {
  tab: "contact" | "lead";
  search: string;
  page: number;
  // By Contact
  callAttempts: CallAttemptsFilter;
  dispositionFilter: string;
  addressTypeFilter: string;
  // By Lead
  statusFilter: "All" | "Open" | "Won" | "Lost";
  stageFilter: string;
  repFilter: string;
  calledFilter: LeadCalledFilter;
  /** ISO lower bound for created_at, computed in the browser so "Today"
   *  means the rep's today, not the server's UTC day. Empty = all dates. */
  createdSince: string;
};

export type DialContactPage = {
  rows: DialContactRow[];
  total: number;
};

/**
 * Per-lead attempts and latest disposition, from log rows ordered
 * newest-first (the first row seen per lead is its most recent call --
 * same derivation the in-browser filter used).
 */
export function buildCallStats(
  logs: { lead_id: string | null; disposition: string }[]
): Map<string, CallStats> {
  const map = new Map<string, CallStats>();
  for (const log of logs) {
    if (!log.lead_id) continue;
    const existing = map.get(log.lead_id);
    if (existing) {
      existing.attempts += 1;
    } else {
      map.set(log.lead_id, { attempts: 1, disposition: log.disposition });
    }
  }
  return map;
}

function matchesAttempts(attempts: number, filter: CallAttemptsFilter): boolean {
  if (filter === "Never") return attempts === 0;
  if (filter === "1x") return attempts === 1;
  if (filter === "2x") return attempts === 2;
  if (filter === "3+") return attempts >= 3;
  return true; // "All"
}

function matchesDisposition(disposition: string, filter: string): boolean {
  if (filter === NO_DISPOSITION) return disposition === NO_DISPOSITION;
  if (filter === "Any Disposition") return disposition !== NO_DISPOSITION;
  return disposition === filter;
}

export type ContactQueryPlan =
  | { mode: "include"; ids: string[] }
  | { mode: "exclude"; ids: string[] };

/**
 * How to query leads for an attempts+disposition combination.
 *
 * A never-called lead has attempts 0 and no disposition. When the combo
 * admits such leads, the answer is "everyone except the called leads
 * that fail it" (exclude); otherwise only called leads can qualify, and
 * the answer is exactly those that pass (include). Ids come back sorted
 * so plans are stable to assert on and to cache.
 */
export function contactQueryPlan(
  stats: Map<string, CallStats>,
  callAttempts: CallAttemptsFilter,
  dispositionFilter: string
): ContactQueryPlan {
  const neverCalledQualifies =
    matchesAttempts(0, callAttempts) && matchesDisposition(NO_DISPOSITION, dispositionFilter);

  const ids: string[] = [];
  for (const [leadId, s] of stats) {
    const passes =
      matchesAttempts(s.attempts, callAttempts) &&
      matchesDisposition(s.disposition, dispositionFilter);
    if (neverCalledQualifies ? !passes : passes) ids.push(leadId);
  }
  ids.sort();
  return neverCalledQualifies ? { mode: "exclude", ids } : { mode: "include", ids };
}

/**
 * The By Lead tab's call-status filter as a query plan. "We haven't
 * dialed them yet" is everyone except the dialed set (exclude); "we
 * called them before" is exactly that set (include). Log rows repeat
 * per call and may lack a lead; the plan carries each dialed lead once,
 * sorted, same shape contactQueryPlan produces.
 */
export function calledFilterPlan(
  dialedLeadIds: (string | null)[],
  filter: "Never" | "Called"
): ContactQueryPlan {
  const ids = [...new Set(dialedLeadIds.filter((id): id is string => id !== null))].sort();
  return filter === "Never" ? { mode: "exclude", ids } : { mode: "include", ids };
}

/**
 * A phone search as an ilike pattern that ignores formatting: "310-697"
 * matches "+1 (310) 697-6137" however the number was typed or imported.
 * Null when the query holds fewer than 3 digits -- the same threshold
 * the in-browser filter used to decide a query is a phone search.
 */
export function digitsSearchPattern(query: string): string | null {
  const digits = query.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return "%" + digits.split("").join("%") + "%";
}
