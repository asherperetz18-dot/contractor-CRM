"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  addressKey,
  addressLine,
  addressSearches,
  noRecordMessage,
  searchFromSuggestion,
  type RadarSearch,
} from "@/lib/data/property-address";

/**
 * PropertyRadar lookups: who really owns the property, what it's worth,
 * and every loan and lien recorded against it.
 *
 * Every fetched result bills PropertyRadar credits, so the rule is ONE
 * PULL PER PROPERTY, company-wide: a house is bought once, and every
 * contact at that address shows the same report. Reports are stored per
 * contact (property_reports.lead_id), but before anything is bought the
 * house is looked for among the company's existing reports -- by address
 * on load, and by RadarID (PropertyRadar's own id for the house) at pull
 * time, which catches two cards spelling the address differently. There
 * is no refresh: a second pull for the same house is refused, and a
 * contact only gets a new pull when its address changes to another house.
 *
 * A pull is two steps. First find the house's RadarID with searches that
 * ask for RadarID only -- PropertyRadar never bills those, so several
 * spellings of the address can be tried (see property-address.ts).
 * Then buy that one record by RadarID: exactly one credit, and only once
 * the house is actually found and known not to be on file already.
 */

export type PropertyTransaction = {
  DocTypeUI?: string;
  Purpose?: string;
  RecDate?: string;
  Grantor?: string;
  Grantee?: string;
  Amount?: number;
  LoanPosition?: string;
  Status?: string;
};

export type PropertyReport = {
  address: string;
  owner: string | null;
  ownership_type: string | null;
  owner_occupied: boolean | null;
  avm: number | null;
  available_equity: number | null;
  equity_percent: number | null;
  total_loan_balance: number | null;
  in_foreclosure: boolean | null;
  listed_for_sale: boolean | null;
  transactions: PropertyTransaction[];
  fetched_at: string;
  /** True when this report was pulled for another contact at the same
   *  address -- shown, not bought again. */
  from_other_contact?: boolean;
};

const API = "https://api.propertyradar.com/v1";

const REPORT_COLUMNS =
  "address, owner, ownership_type, owner_occupied, avm, available_equity, equity_percent, total_loan_balance, in_foreclosure, listed_for_sale, transactions, fetched_at";

/** A stored report plus what identifies the house it is about. */
type StoredReport = PropertyReport & { lead_id: string; radar_id: string | null };

const STORED_COLUMNS = `lead_id, radar_id, ${REPORT_COLUMNS}`;

function publicReport(row: StoredReport, fromOtherContact: boolean): PropertyReport {
  return {
    address: row.address,
    owner: row.owner,
    ownership_type: row.ownership_type,
    owner_occupied: row.owner_occupied,
    avm: row.avm,
    available_equity: row.available_equity,
    equity_percent: row.equity_percent,
    total_loan_balance: row.total_loan_balance,
    in_foreclosure: row.in_foreclosure,
    listed_for_sale: row.listed_for_sale,
    transactions: row.transactions ?? [],
    fetched_at: row.fetched_at,
    ...(fromOtherContact ? { from_other_contact: true } : {}),
  };
}

/** For an ilike pattern: the street's own % and _ must not act as wildcards. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The company's report for this house, if any contact already has one.
 * Matched by address key (see property-address.ts), so "Chatsworth CA"
 * and "Chatsworth, CA" are the same house. The ilike on the house number
 * and first word of the street ("10229 Oakdale") only narrows the rows
 * fetched; the key decides. `except` is the contact being looked at.
 */
async function reportForAddress(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  address: string,
  except: string
): Promise<StoredReport | null> {
  const key = addressKey(address);
  if (!key) return null;
  const start = key.split("|")[0].split(" ").slice(0, 2).join(" ");
  const { data } = await supabase
    .from("property_reports")
    .select(STORED_COLUMNS)
    .eq("company_id", companyId)
    .neq("lead_id", except)
    .ilike("address", `%${likeEscape(start)}%`)
    .limit(50);
  const rows = (data ?? []) as StoredReport[];
  return rows.find((r) => addressKey(r.address) === key) ?? null;
}

/** The company's report for this RadarID, if any contact already has one. */
async function reportForRadarId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  radarId: string,
  except: string
): Promise<StoredReport | null> {
  const { data } = await supabase
    .from("property_reports")
    .select(STORED_COLUMNS)
    .eq("company_id", companyId)
    .eq("radar_id", radarId)
    .neq("lead_id", except)
    .limit(1);
  const rows = (data ?? []) as StoredReport[];
  return rows[0] ?? null;
}

/** The paid fields of the one record bought once the house is found. */
const REPORT_FIELDS =
  "RadarID,Owner,OwnershipType,isSameMailingOrExempt,AVM,AvailableEquity,EquityPercent,TotalLoanBalance,inForeclosure,isListedForSale";

type RadarResponse = {
  results?: Record<string, unknown>[];
  resultCount?: number;
  totalResultCount?: number;
  error?: string;
  message?: string;
};

/** PropertyRadar's own wording for a refused request, if it gave one. */
function apiComplaint(json: RadarResponse | null): string | null {
  const text = json?.message || json?.error;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

/**
 * One free search: RadarID only, Purchase=0, so nothing is billed
 * whatever it finds. `total` is the count PropertyRadar reports for the
 * whole search, not just the two rows asked for -- a loose search that
 * must be unique is judged on it.
 */
async function searchRadarId(
  headers: Record<string, string>,
  search: RadarSearch
): Promise<{ radarId: string | null; total: number; status: number; complaint: string | null }> {
  const res = await fetch(`${API}/properties?Fields=RadarID&Purchase=0&Limit=2`, {
    method: "POST",
    headers,
    body: JSON.stringify({ Criteria: search.criteria }),
  });
  const json = (await res.json().catch(() => null)) as RadarResponse | null;
  if (!res.ok) return { radarId: null, total: 0, status: res.status, complaint: apiComplaint(json) };
  const results = Array.isArray(json?.results) ? json.results : [];
  const total = Number(json?.totalResultCount ?? json?.resultCount ?? results.length) || results.length;
  const first = results[0]?.RadarID;
  if (!first || (search.mustBeUnique && (total !== 1 || results.length !== 1))) {
    return { radarId: null, total, status: res.status, complaint: null };
  }
  return { radarId: String(first), total, status: res.status, complaint: null };
}

/**
 * PropertyRadar's own reading of the address: the search box's first
 * suggestion for it, as criteria in PropertyRadar's spelling (its city
 * name for the house, its ZIP). No search when it offers nothing usable;
 * any trouble here just means one fewer search to try. The note is for
 * the server log, so a failed pull shows what this call got back too.
 */
async function suggestedSearch(
  headers: Record<string, string>,
  full: string
): Promise<{ search: RadarSearch | null; note: string }> {
  const line = addressLine(full);
  if (!line) return { search: null, note: "suggestion: no address" };
  try {
    const res = await fetch(
      `${API}/suggestions/SiteAddress?SuggestionInput=${encodeURIComponent(line)}&Limit=1`,
      { method: "POST", headers, body: JSON.stringify({}) }
    );
    const json = (await res.json().catch(() => null)) as {
      results?: { Label?: string; Criteria?: { name: string; value: (string | number)[] }[] }[];
      error?: string;
      message?: string;
    } | null;
    if (!res.ok) {
      return { search: null, note: `suggestion: ${res.status} ${apiComplaint(json) ?? ""}`.trim() };
    }
    const first = json?.results?.[0];
    const search = searchFromSuggestion(first);
    // The label and criteria names only -- enough to see what came back.
    const shape = first
      ? `${first.Label ?? "?"} [${(first.Criteria ?? []).map((c) => c.name).join(",")}]`
      : "no results";
    return { search, note: `suggestion: ${res.status} ${search ? "usable" : "unusable"} ${shape}` };
  } catch {
    return { search: null, note: "suggestion: unreachable" };
  }
}

/**
 * The RadarID for the contact's address, or the message to show when
 * there is none. Tries every search in property-address.ts in order and
 * stops at the first hit; a sign-in or credit problem stops at once with
 * PropertyRadar's words, since retrying it with other spellings can't help.
 */
async function findRadarId(
  headers: Record<string, string>,
  full: string
): Promise<{ radarId: string; via: string } | { error: string }> {
  const suggested = await suggestedSearch(headers, full);
  const searches = addressSearches(full, suggested.search);
  if (!searches.length) {
    console.warn("[propertyradar] unreadable address", { address: full, note: suggested.note });
    return { error: noRecordMessage(full, searches) };
  }

  let complaint: string | null = null;
  let anyAnswered = false;
  const attempts: string[] = [suggested.note];
  for (const search of searches) {
    const r = await searchRadarId(headers, search);
    if (r.radarId) return { radarId: r.radarId, via: search.label };
    attempts.push(`${search.label}: ${r.status} ${r.total}${r.complaint ? ` ${r.complaint}` : ""}`);
    if (r.status === 401 || r.status === 402 || r.status === 403) {
      return { error: r.complaint || "PropertyRadar refused the lookup." };
    }
    if (r.status < 400) anyAnswered = true;
    complaint ??= r.complaint;
  }
  // Server log only (Vercel > Logs): what each search got back, without the token.
  console.warn("[propertyradar] no record", { address: full, attempts });
  // PropertyRadar's complaint is shown only when it refused every search --
  // then the request is wrong, not the address. A search it answered with
  // zero results is a real "not on file", and a rejected variant beside it
  // would only muddy that.
  return { error: noRecordMessage(full, searches, anyAnswered ? null : complaint) };
}

async function loadLead(leadId: string) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." as const };
  const supabase = await createClient();
  // As the signed-in user, so RLS decides whether they can see this
  // contact at all -- the report must not be a side door into another
  // rep's book.
  const { data: lead } = await supabase
    .from("leads")
    .select("id, address, company_id")
    .eq("id", leadId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; address: string | null; company_id: string }>();
  if (!lead) return { error: "Contact not found." as const };
  return { profile, lead };
}

export async function getPropertyReport(
  leadId: string
): Promise<{ error?: string; configured?: boolean; report?: PropertyReport | null }> {
  const loaded = await loadLead(leadId);
  if ("error" in loaded) return { error: loaded.error };
  const { lead } = loaded;

  const configured = !!process.env.PROPERTYRADAR_API_TOKEN;
  const supabase = await createClient();
  const { data: own } = await supabase
    .from("property_reports")
    .select(STORED_COLUMNS)
    .eq("lead_id", leadId)
    .maybeSingle<StoredReport>();

  // A report pulled for a different address is a report about somebody
  // else's house; better to show nothing than the wrong owner.
  if (own && (!lead.address || addressKey(own.address) === addressKey(lead.address))) {
    return { configured, report: publicReport(own, false) };
  }
  // One pull per property: another contact at this address already has
  // the report, so this card shows it instead of offering to buy it.
  if (lead.address) {
    const shared = await reportForAddress(supabase, lead.company_id, lead.address, leadId);
    if (shared) return { configured, report: publicReport(shared, true) };
  }
  return { configured, report: null };
}

export async function fetchPropertyReport(
  leadId: string
): Promise<{ error?: string; report?: PropertyReport }> {
  const token = process.env.PROPERTYRADAR_API_TOKEN;
  if (!token) return { error: "PropertyRadar isn't connected yet." };

  const loaded = await loadLead(leadId);
  if ("error" in loaded) return { error: loaded.error };
  const { profile, lead } = loaded;
  if (!lead.address?.trim()) return { error: "This contact has no address on file." };

  // One pull per property. Already pulled for this contact, or for another
  // contact at the same address: hand that back, buy nothing. The button
  // is hidden when a report shows, so this is the guard against a stale
  // screen or a double click, not the normal path.
  const supabase = await createClient();
  const { data: own } = await supabase
    .from("property_reports")
    .select(STORED_COLUMNS)
    .eq("lead_id", leadId)
    .maybeSingle<StoredReport>();
  if (own && addressKey(own.address) === addressKey(lead.address)) {
    return { report: publicReport(own, false) };
  }
  const byAddress = await reportForAddress(supabase, lead.company_id, lead.address, leadId);
  if (byAddress) return { report: publicReport(byAddress, true) };

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    // Step 1, free: which house is this?
    const found = await findRadarId(headers, lead.address);
    if ("error" in found) return { error: found.error };
    const radarId = found.radarId;

    // Still one pull per property: the same house under another spelling
    // on another card is found by PropertyRadar's own id for it. Copy
    // that report onto this contact rather than buying it twice.
    const byRadarId = await reportForRadarId(supabase, lead.company_id, radarId, leadId);
    if (byRadarId) {
      const admin = createAdminClient();
      const { lead_id: sourceLead, ...copy } = byRadarId;
      console.info("[propertyradar] reused report, nothing bought", { radarId, from: sourceLead, to: leadId });
      const { error: copyErr } = await admin.from("property_reports").upsert({
        ...copy,
        lead_id: leadId,
        company_id: profile.company_id,
        address: lead.address,
        fetched_by: profile.id,
      });
      if (copyErr) return { error: copyErr.message };
      return { report: publicReport({ ...byRadarId, address: lead.address }, true) };
    }

    // Step 2, the one credit: the record itself, by RadarID.
    const res = await fetch(
      `${API}/properties/${encodeURIComponent(radarId)}?Fields=${REPORT_FIELDS}&Purchase=1`,
      { headers }
    );
    const json = (await res.json().catch(() => null)) as RadarResponse | null;
    if (!res.ok) {
      return { error: apiComplaint(json) || "PropertyRadar refused to return the record." };
    }
    const match = json?.results?.[0];
    if (!match) {
      return { error: "PropertyRadar found the property but sent back no details. Try again in a moment." };
    }

    // The chain of title: deeds, every loan, assignments, NODs, liens.
    let transactions: PropertyTransaction[] = [];
    const txRes = await fetch(
      `${API}/properties/${encodeURIComponent(radarId)}/transactions?Purchase=1`,
      { headers }
    );
    const txJson = (await txRes.json().catch(() => null)) as {
      results?: PropertyTransaction[];
    } | null;
    if (txRes.ok && Array.isArray(txJson?.results)) {
      transactions = txJson.results.map((t) => ({
        DocTypeUI: t.DocTypeUI,
        Purpose: t.Purpose,
        RecDate: t.RecDate,
        Grantor: t.Grantor,
        Grantee: t.Grantee,
        Amount: t.Amount,
        LoanPosition: t.LoanPosition,
        Status: t.Status,
      }));
    }

    const asBool = (v: unknown) => (v === null || v === undefined ? null : Number(v) === 1);
    const asNum = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

    const row = {
      lead_id: leadId,
      company_id: profile.company_id,
      address: lead.address,
      radar_id: radarId,
      owner: match.Owner != null ? String(match.Owner) : null,
      ownership_type: match.OwnershipType != null ? String(match.OwnershipType) : null,
      owner_occupied: asBool(match.isSameMailingOrExempt),
      avm: asNum(match.AVM),
      available_equity: asNum(match.AvailableEquity),
      equity_percent: asNum(match.EquityPercent),
      total_loan_balance: asNum(match.TotalLoanBalance),
      in_foreclosure: asBool(match.inForeclosure),
      listed_for_sale: asBool(match.isListedForSale),
      transactions,
      fetched_by: profile.id,
      fetched_at: new Date().toISOString(),
    };

    const admin = createAdminClient();
    const { error: saveErr } = await admin.from("property_reports").upsert(row);
    if (saveErr) return { error: saveErr.message };

    return {
      report: {
        address: row.address,
        owner: row.owner,
        ownership_type: row.ownership_type,
        owner_occupied: row.owner_occupied,
        avm: row.avm,
        available_equity: row.available_equity,
        equity_percent: row.equity_percent,
        total_loan_balance: row.total_loan_balance,
        in_foreclosure: row.in_foreclosure,
        listed_for_sale: row.listed_for_sale,
        transactions: row.transactions,
        fetched_at: row.fetched_at,
      },
    };
  } catch {
    return { error: "Couldn't reach PropertyRadar. Try again in a moment." };
  }
}
