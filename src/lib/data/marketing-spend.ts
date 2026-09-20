import type { DateWindow } from "./date-range.ts";

/**
 * Marketing spend, entered per source per month (marketing_spend,
 * migration 0165), and what a report window may claim of it.
 *
 * Before this the only cost on the page was leads.lead_cost, which
 * migration 0089 stamps with the company default ($375) on every new
 * lead -- so "cost per lead" read $375 on 96% of the book and measured
 * nothing. Real spend is a monthly figure per source (the invoice from
 * the lead vendor, the month's ad budget); a window rarely lines up
 * with a calendar month, so it claims each month's amount in proportion
 * to the days it covers, and never a day that hasn't happened yet. All
 * time claims everything, future entries included.
 */

export type SpendRow = { source: string; month: string; amount_cents: number };

/** The first of a day's month, as the marketing_spend.month key. */
export function monthKey(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** Day index in UTC, so a span is counted the same across DST. */
function dayNumber(day: string): number {
  return Math.round(new Date(`${day}T00:00:00Z`).getTime() / 86400000);
}

/** Cents of spend the window can claim, by source. */
export function spendInWindow(
  rows: SpendRow[],
  win: DateWindow,
  today: string
): Record<string, number> {
  const out: Record<string, number> = {};
  const allTime = !win.from && !win.to;
  for (const r of rows) {
    const cents = Number(r.amount_cents) || 0;
    if (cents <= 0) continue;
    let claim = cents;
    if (!allTime) {
      const mStart = monthKey(r.month);
      const mEnd = `${mStart.slice(0, 7)}-${String(daysInMonth(mStart)).padStart(2, "0")}`;
      const from = win.from && win.from > mStart ? win.from : mStart;
      const cap = win.to && win.to < today ? win.to : today;
      const to = cap < mEnd ? cap : mEnd;
      if (to < from) continue;
      const days = dayNumber(to) - dayNumber(from) + 1;
      claim = Math.round((cents * days) / daysInMonth(mStart));
    }
    out[r.source] = (out[r.source] ?? 0) + claim;
  }
  return out;
}

export type CostBasis = {
  costPerLeadCents: number | null;
  costPerSaleCents: number | null;
  /** What the figures are built on: entered spend, hand-priced leads,
   *  the company default alone, or nothing at all. */
  basis: "spend" | "lead_cost" | "default" | "none";
};

/**
 * A source's cost per lead and per sale, and how much to trust them.
 *
 * Real spend divides over every lead the source produced, priced or
 * not; without it, lead_cost averages over the leads that carry one --
 * and when every one of those carries exactly the default, the figure
 * is the placeholder, and says so rather than posing as a measurement.
 */
export function sourceCost(i: {
  spendCents: number;
  leads: number;
  signed: number;
  leadCostDollars: number;
  costKnown: number;
  atDefault: number;
}): CostBasis {
  if (i.spendCents > 0) {
    return {
      costPerLeadCents: i.leads > 0 ? Math.round(i.spendCents / i.leads) : null,
      costPerSaleCents: i.signed > 0 ? Math.round(i.spendCents / i.signed) : null,
      basis: "spend",
    };
  }
  if (i.costKnown > 0) {
    const total = Math.round(i.leadCostDollars * 100);
    return {
      costPerLeadCents: Math.round(total / i.costKnown),
      costPerSaleCents: i.signed > 0 ? Math.round(total / i.signed) : null,
      basis: i.atDefault === i.costKnown ? "default" : "lead_cost",
    };
  }
  return { costPerLeadCents: null, costPerSaleCents: null, basis: "none" };
}
