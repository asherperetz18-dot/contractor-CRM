"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";

/**
 * PropertyRadar lookups: who really owns the property, what it's worth,
 * and every loan and lien recorded against it.
 *
 * Every fetched result bills a PropertyRadar credit, so reports cache
 * per contact and a fresh pull happens only on an explicit click (or
 * when the contact's address has changed since the cached pull).
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
};

const API = "https://api.propertyradar.com/v1";

const REPORT_COLUMNS =
  "address, owner, ownership_type, owner_occupied, avm, available_equity, equity_percent, total_loan_balance, in_foreclosure, listed_for_sale, transactions, fetched_at";

/**
 * "1303 W Farlington St, West Covina, CA 91790, USA" into the pieces
 * PropertyRadar's criteria want. The state+zip segment splits on the
 * last space; a trailing country segment is dropped.
 */
function splitAddress(full: string): { street: string; city: string; state: string } | null {
  const parts = full
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 3 && /^(usa|united states)$/i.test(parts[parts.length - 1])) parts.pop();
  if (parts.length < 3) return null;
  const stateZip = parts[parts.length - 1];
  const state = stateZip.split(/\s+/)[0];
  const city = parts[parts.length - 2];
  const street = parts.slice(0, parts.length - 2).join(", ");
  if (!street || !city || !/^[A-Za-z]{2}$/.test(state)) return null;
  return { street, city, state };
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
  const { data: report } = await supabase
    .from("property_reports")
    .select(REPORT_COLUMNS)
    .eq("lead_id", leadId)
    .maybeSingle<PropertyReport>();

  // A report pulled for a different address is a report about somebody
  // else's house; better to show nothing than the wrong owner.
  if (report && lead.address && report.address !== lead.address) {
    return { configured, report: null };
  }
  return { configured, report: report ?? null };
}

export async function fetchPropertyReport(
  leadId: string
): Promise<{ error?: string; report?: PropertyReport }> {
  const token = process.env.PROPERTYRADAR_API_TOKEN;
  if (!token) return { error: "PropertyRadar isn't connected yet." };

  const loaded = await loadLead(leadId);
  if ("error" in loaded) return { error: loaded.error };
  const { profile, lead } = loaded;
  if (!lead.address) return { error: "This contact has no address on file." };

  const parts = splitAddress(lead.address);
  if (!parts) {
    return { error: "Couldn't read street, city and state from this address." };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const criteria = {
    Criteria: [
      { name: "Address", value: [parts.street] },
      { name: "City", value: [parts.city] },
      { name: "State", value: [parts.state] },
    ],
  };

  try {
    const fields =
      "RadarID,Owner,OwnershipType,isSameMailingOrExempt,AVM,AvailableEquity,EquityPercent,TotalLoanBalance,inForeclosure,isListedForSale";
    const res = await fetch(`${API}/properties?Fields=${fields}&Purchase=1`, {
      method: "POST",
      headers,
      body: JSON.stringify(criteria),
    });
    const json = (await res.json().catch(() => null)) as {
      results?: Record<string, unknown>[];
      error?: string;
    } | null;
    if (!res.ok) return { error: json?.error || "PropertyRadar refused the lookup." };
    const match = json?.results?.[0];
    if (!match) {
      return { error: "PropertyRadar has no record for this address." };
    }

    // The chain of title: deeds, every loan, assignments, NODs, liens.
    let transactions: PropertyTransaction[] = [];
    const radarId = String(match.RadarID ?? "");
    if (radarId) {
      const txRes = await fetch(`${API}/properties/${radarId}/transactions?Purchase=1`, {
        headers,
      });
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
    }

    const asBool = (v: unknown) => (v === null || v === undefined ? null : Number(v) === 1);
    const asNum = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

    const row = {
      lead_id: leadId,
      company_id: profile.company_id,
      address: lead.address,
      radar_id: radarId || null,
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

