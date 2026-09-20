/**
 * Who a signed contract counts for.
 *
 * Three answers used to exist. The document carries the rep it was
 * stamped with at creation (estimates.assigned_to -- often whoever held
 * the lead when the draft was raised); the lead carries whoever holds
 * it now; and the contract's Sales team panel carries the seats the
 * commission is actually paid on (sales_rep_1/2 with their shares --
 * 0086, 0135, 0163), seeded from the lead at signature and corrected by
 * the office afterwards. The pages that count sales per rep read the
 * first of those, and put an $8,000 job on the rep in the zero-share
 * second seat while the panel said 100% Frank.
 *
 * The seats are the office's own statement of who sold it, so a sale is
 * credited to them: every seat with a share gets the sale, the dollars
 * split by share (the Salespeople grid's partnership rule, DECISIONS
 * #050). A contract with no seats at all -- signed before the panel
 * existed -- falls back to the stamped rep, whole. The closer follows a
 * sale with a cut and never holds it.
 */

export type SaleSeats = {
  assigned_to: string | null;
  sales_rep_1?: string | null;
  sales_rep_1_bp?: number | null;
  sales_rep_2?: string | null;
  sales_rep_2_bp?: number | null;
};

export type SaleCredit = { rep: string; bp: number };

export function saleCredits(e: SaleSeats): SaleCredit[] {
  const seats: SaleCredit[] = [];
  if (e.sales_rep_1) seats.push({ rep: e.sales_rep_1, bp: e.sales_rep_1_bp ?? 10000 });
  if (e.sales_rep_2) seats.push({ rep: e.sales_rep_2, bp: e.sales_rep_2_bp ?? 0 });
  const credited = seats.filter((s) => s.bp > 0);
  if (credited.length > 0) return credited;
  // Seats named but no share anywhere: seat one is the salesperson.
  if (seats.length > 0) return [{ rep: seats[0].rep, bp: 10000 }];
  return e.assigned_to ? [{ rep: e.assigned_to, bp: 10000 }] : [];
}

/** A share of a contract's cents, in basis points; the shares of a
 *  50/50 split may round to a cent more than the total, never less. */
export function splitCents(totalCents: number, bp: number): number {
  return Math.round(((totalCents || 0) * bp) / 10000);
}
