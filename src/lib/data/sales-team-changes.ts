/**
 * What one sales-team edit on a signed contract actually changed, in
 * the words the panel uses. The audit table stores raw before/after
 * snapshots (sales_team_changes, 0154) and this renders them at read
 * time, so the wording can improve later without restating history.
 *
 * The snapshot is the row as stored, nulls included: a null rate is a
 * contract nobody has saved yet, which is a different fact from 0%.
 */
export type SalesTeamSnapshot = {
  sales_rep_1: string | null;
  sales_rep_1_bp: number | null;
  sales_rep_2: string | null;
  sales_rep_2_bp: number | null;
  closer_id: string | null;
  closer_pool_bp: number | null;
  commission_rate_bp: number | null;
  lead_cost_bp: number | null;
};

export function describeSalesTeamChange(
  before: SalesTeamSnapshot,
  after: SalesTeamSnapshot,
  repName: (id: string) => string
): string[] {
  const pct = (bp: number | null) => (bp === null ? "unset" : `${bp / 100}%`);
  const seat = (id: string | null) => (id === null ? "none" : repName(id));
  const lines: string[] = [];
  const moved = (label: string, from: string, to: string) =>
    lines.push(`${label}: ${from} → ${to}`);

  if (before.lead_cost_bp !== after.lead_cost_bp) {
    moved("Lead cost %", pct(before.lead_cost_bp), pct(after.lead_cost_bp));
  }
  if (before.commission_rate_bp !== after.commission_rate_bp) {
    moved("Commission % of net", pct(before.commission_rate_bp), pct(after.commission_rate_bp));
  }
  if (before.sales_rep_1 !== after.sales_rep_1) {
    moved("Salesperson", seat(before.sales_rep_1), seat(after.sales_rep_1));
  }
  if (before.sales_rep_2 !== after.sales_rep_2) {
    moved("Second salesperson", seat(before.sales_rep_2), seat(after.sales_rep_2));
  }
  // The two rep shares always make a whole, so a rebalance is one
  // decision -- one line, not a line per number.
  if (
    before.sales_rep_1_bp !== after.sales_rep_1_bp ||
    before.sales_rep_2_bp !== after.sales_rep_2_bp
  ) {
    lines.push(
      `Share split: ${pct(before.sales_rep_1_bp)} / ${pct(before.sales_rep_2_bp)}` +
        ` → ${pct(after.sales_rep_1_bp)} / ${pct(after.sales_rep_2_bp)}`
    );
  }
  if (before.closer_id !== after.closer_id) {
    moved("Closer", seat(before.closer_id), seat(after.closer_id));
  }
  if (before.closer_pool_bp !== after.closer_pool_bp) {
    moved("Closer share of pool", pct(before.closer_pool_bp), pct(after.closer_pool_bp));
  }
  return lines;
}

/** A change is recorded iff it would describe as one -- the same rule
 *  decides both, so the trail can never hold an empty entry. */
export function salesTeamChanged(before: SalesTeamSnapshot, after: SalesTeamSnapshot) {
  return describeSalesTeamChange(before, after, () => "").length > 0;
}
