/**
 * The "Lead cost" box on a lead source (Settings › Lead Sources) and the
 * company default beside it.
 *
 * Two answers that look alike and mean opposite things: blank is "this
 * source has no figure of its own, the company default applies", stored
 * as null; a typed 0 is "leads from here are free", stored as 0. The
 * database trigger (migration 0164) reads them the same way.
 *
 * Dollars, not cents -- these feed `leads.lead_cost`, which has been
 * dollars since 0023 (see TECH_DEBT).
 */
export type LeadCostInput = { value: number | null } | { error: string };

export function parseLeadCostInput(raw: string): LeadCostInput {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "") return { value: null };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { error: "Lead cost must be a number, like 375 or 0." };
  if (n < 0) return { error: "Lead cost can't be negative." };
  return { value: Math.round(n * 100) / 100 };
}

/** The other direction: a stored cost as the text the box shows. */
export function leadCostInputValue(cost: number | null | undefined): string {
  return cost == null ? "" : String(cost);
}
