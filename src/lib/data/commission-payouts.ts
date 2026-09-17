/**
 * The payout ledger's arithmetic: commission owed vs. money actually
 * handed over.
 *
 * The commission report (rep-commission.ts) computes what each rep has
 * EARNED and what has become PAYABLE, live from the contracts. The
 * ledger (rep_commission_payouts, migration 0158) records what has
 * actually been PAID -- payouts, and advances given before a job
 * settled. This file joins the two into balances, and it is pure so
 * payroll maths is tested rather than assumed.
 *
 * Two rules the tests pin down:
 *  - Netting is per rep, never across reps. One rep advanced ahead
 *    does not shrink what another rep is owed.
 *  - An advance past what is payable shows as "ahead", not as a
 *    negative due -- it nets against the rep's next qualifying job.
 */

export type PayoutKind = "payout" | "advance";

/** One ledger row, as the maths needs it. */
export type PayoutLike = {
  repId: string;
  amountCents: number;
  /** The day the money moved, YYYY-MM-DD. */
  paidOn: string;
  kind: PayoutKind;
};

/** One commission line (one rep's seat on one contract), as the maths
 *  needs it. Mapped from RepCommissionRow at the call sites. */
export type CommissionLineLike = {
  repId: string;
  shareCents: number;
  /** Every hold cleared -- the job is finished and settled. */
  payable: boolean;
  /** When the last hold cleared; null while held (or unknowable). */
  qualifiedAt: string | null;
  /** No costs recorded yet, so the share is not a real figure. */
  unmeasured: boolean;
};

export type RepBalance = {
  repId: string;
  /** Share of net profit on measured jobs, payable or not. */
  earnedCents: number;
  /** The part that has come due. */
  payableCents: number;
  /** Everything handed over: payouts and advances together. */
  paidCents: number;
  /** The advance part of paidCents, kept apart for display. */
  advanceCents: number;
  /** Still to pay: payable less paid, floored at zero. */
  dueCents: number;
  /** Paid beyond what is payable -- nets against the next job. */
  aheadCents: number;
};

const day = (iso: string) => iso.slice(0, 10);

function blank(repId: string): RepBalance {
  return {
    repId,
    earnedCents: 0,
    payableCents: 0,
    paidCents: 0,
    advanceCents: 0,
    dueCents: 0,
    aheadCents: 0,
  };
}

/** Each rep's all-time position: earned, payable, paid, and what is
 *  still due -- the page's cards and per-rep summary. */
export function repBalances(
  lines: readonly CommissionLineLike[],
  payouts: readonly PayoutLike[]
): Map<string, RepBalance> {
  const byRep = new Map<string, RepBalance>();
  const of = (repId: string) => {
    const b = byRep.get(repId) ?? blank(repId);
    byRep.set(repId, b);
    return b;
  };

  for (const l of lines) {
    const b = of(l.repId);
    if (!l.unmeasured) b.earnedCents += l.shareCents;
    if (l.payable) b.payableCents += l.shareCents;
  }
  for (const p of payouts) {
    const b = of(p.repId);
    b.paidCents += p.amountCents;
    if (p.kind === "advance") b.advanceCents += p.amountCents;
  }
  for (const b of byRep.values()) {
    b.dueCents = Math.max(0, b.payableCents - b.paidCents);
    b.aheadCents = Math.max(0, b.paidCents - b.payableCents);
  }
  return byRep;
}

/** The cards' totals. Due and ahead are summed per rep, never netted
 *  across reps: money advanced to one rep is not another rep's pay. */
export function balanceTotals(balances: Iterable<RepBalance>): Omit<RepBalance, "repId"> {
  const t = blank("");
  for (const b of balances) {
    t.earnedCents += b.earnedCents;
    t.payableCents += b.payableCents;
    t.paidCents += b.paidCents;
    t.advanceCents += b.advanceCents;
    t.dueCents += b.dueCents;
    t.aheadCents += b.aheadCents;
  }
  const { repId: _repId, ...totals } = t;
  return totals;
}

export type PeriodBalance = {
  /** Owed coming into the period: qualified before it, less paid
   *  before it. Negative means the rep started the period advanced
   *  ahead. */
  openingCents: number;
  /** Commission that came due inside the period. */
  qualifiedCents: number;
  /** Money handed over inside the period, advances included. */
  paidCents: number;
  /** opening + qualified - paid. Negative means advanced ahead. */
  closingCents: number;
};

/**
 * One rep's statement period, read like a bank statement.
 *
 * A line counts on the day it qualified (holds cleared), a payment on
 * the day the money moved; both ends of the period are inclusive, and
 * anything dated after the period belongs to the next statement.
 * Payable lines with no qualifying date are carried in the opening
 * balance -- owed money must appear on every statement until paid.
 *
 * Call this with ONE rep's lines and payouts. Summing several reps
 * through it would net one rep's overpay against another's due; use
 * periodBalancesByRep for a mixed set.
 */
export function periodBalance(
  lines: readonly CommissionLineLike[],
  payouts: readonly PayoutLike[],
  from: string,
  to: string
): PeriodBalance {
  let openingCents = 0;
  let qualifiedCents = 0;
  let paidCents = 0;

  for (const l of lines) {
    if (!l.payable) continue;
    const q = l.qualifiedAt ? day(l.qualifiedAt) : null;
    if (q === null || q < from) openingCents += l.shareCents;
    else if (q <= to) qualifiedCents += l.shareCents;
    // q > to: the next statement's business.
  }
  for (const p of payouts) {
    if (p.paidOn < from) openingCents -= p.amountCents;
    else if (p.paidOn <= to) paidCents += p.amountCents;
  }

  return {
    openingCents,
    qualifiedCents,
    paidCents,
    closingCents: openingCents + qualifiedCents - paidCents,
  };
}

/** periodBalance per rep, for the all-salespeople statement. */
export function periodBalancesByRep(
  lines: readonly CommissionLineLike[],
  payouts: readonly PayoutLike[],
  from: string,
  to: string
): Map<string, PeriodBalance> {
  const repIds = new Set<string>();
  for (const l of lines) repIds.add(l.repId);
  for (const p of payouts) repIds.add(p.repId);

  const byRep = new Map<string, PeriodBalance>();
  for (const repId of repIds) {
    byRep.set(
      repId,
      periodBalance(
        lines.filter((l) => l.repId === repId),
        payouts.filter((p) => p.repId === repId),
        from,
        to
      )
    );
  }
  return byRep;
}
