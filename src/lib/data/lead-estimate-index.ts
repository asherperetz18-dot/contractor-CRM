import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canCreateEstimates,
  canViewEstimates,
  paidTotalCents,
  type EstimateStatus,
} from "@/lib/data/types";

export type LeadEstimateSummaryRow = {
  id: string;
  doc_number: string;
  title: string;
  status: EstimateStatus;
  total_cents: number;
};

export type LeadEstimateIndex = {
  /** Keyed by lead id. Absent means the lead has none. */
  byLead: Record<string, { estimates: LeadEstimateSummaryRow[]; paidCents: number }>;
  canView: boolean;
  canCreate: boolean;
};

export const EMPTY_ESTIMATE_INDEX: LeadEstimateIndex = {
  byLead: {},
  canView: false,
  canCreate: false,
};

/**
 * Every estimate in the company, grouped by the lead it belongs to.
 *
 * Loaded once with the page so the contact card's estimate chip is there
 * on the first frame. It used to fetch per contact as the card opened,
 * which meant the chip arrived about two seconds late and shoved the
 * rest of the row sideways as it appeared -- long enough to click the
 * wrong thing.
 *
 * Whole-company rather than per-lead because it is small: 37 estimates
 * and 11 payments across the whole book. Grouping them costs less than
 * the round trip it replaces.
 *
 * Runs as the signed-in user, so RLS narrows it exactly as the Estimates
 * page is narrowed -- a dispatcher gets their own leads' documents and
 * nothing else.
 */
export async function getLeadEstimateIndex(): Promise<LeadEstimateIndex> {
  const profile = await getCurrentProfile();
  if (!profile || !canViewEstimates(profile)) return EMPTY_ESTIMATE_INDEX;

  const supabase = await createClient();
  const { data: estimates } = await supabase
    .from("estimates")
    .select("id, lead_id, doc_number, title, status, total_cents")
    .eq("company_id", profile.company_id)
    .order("created_at", { ascending: false })
    .returns<(LeadEstimateSummaryRow & { lead_id: string | null })[]>();

  const rows = estimates ?? [];
  const { data: payments } = await supabase
    .from("portal_payments")
    .select("estimate_id, amount_cents, status")
    .eq("company_id", profile.company_id)
    .returns<{ estimate_id: string; amount_cents: number; status: string }[]>();

  const paidByEstimate = new Map<string, { amount_cents: number; status: string }[]>();
  for (const p of payments ?? []) {
    const list = paidByEstimate.get(p.estimate_id) ?? [];
    list.push(p);
    paidByEstimate.set(p.estimate_id, list);
  }

  const byLead: LeadEstimateIndex["byLead"] = {};
  for (const e of rows) {
    if (!e.lead_id) continue;
    const entry = byLead[e.lead_id] ?? { estimates: [], paidCents: 0 };
    entry.estimates.push({
      id: e.id,
      doc_number: e.doc_number,
      title: e.title,
      status: e.status,
      total_cents: e.total_cents,
    });
    entry.paidCents += paidTotalCents((paidByEstimate.get(e.id) ?? []) as never);
    byLead[e.lead_id] = entry;
  }

  return { byLead, canView: true, canCreate: canCreateEstimates(profile) };
}
