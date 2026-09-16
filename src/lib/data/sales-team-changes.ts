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

/** The three seats that decide WHO is paid, as opposed to how much. */
export type SeatHolders = Pick<SalesTeamSnapshot, "sales_rep_1" | "sales_rep_2" | "closer_id">;

export function seatHoldersChanged(before: SeatHolders, after: SeatHolders): boolean {
  return (
    before.sales_rep_1 !== after.sales_rep_1 ||
    before.sales_rep_2 !== after.sales_rep_2 ||
    before.closer_id !== after.closer_id
  );
}

/**
 * Who may change the seat holders on a signed contract: Admin only.
 *
 * The seats stay editable after signature by design (026) -- the office
 * corrects a wrong seat, settles a handoff -- but a swap restates pay:
 * the old rep's line leaves the statement while the document itself
 * keeps naming whoever sold the job, and the two screens then disagree
 * about the same contract. That is an owner's call, so Office keeps the
 * shares and rates but moving a seat to a different person needs the
 * Admin role. Filling a seat from empty counts too: adding someone to
 * the pay is as much a pay decision as replacing them.
 *
 * A hold on top of the existing Office-or-Admin gate, never a widening,
 * and enforced in the server action for 024's reason: saveSalesTeam is
 * the only in-app path that edits these columns after signature.
 */
export function seatChangeError(input: {
  /** estimates.status -- the hold exists for signed contracts only. */
  status: string;
  /** isStrictAdmin: the Admin role or the super admin, not Office. */
  strictAdmin: boolean;
  before: SeatHolders;
  after: SeatHolders;
}): string | null {
  if (input.status !== "Signed") return null;
  if (input.strictAdmin) return null;
  if (!seatHoldersChanged(input.before, input.after)) return null;
  return "Only an Admin can change who is paid on a signed contract. Shares and rates you can still adjust.";
}
