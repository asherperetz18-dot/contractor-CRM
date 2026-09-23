/** The fields of a Stripe price the pricing card reads. */
export type PlanPriceInput = {
  unit_amount: number | null;
  currency: string;
  recurring: { interval: string; interval_count: number } | null;
};

/**
 * A Stripe price as the front page's pricing card prints it: "$149" over
 * "per month". Null when the price has no fixed amount (metered or
 * customer-chosen), so the card says nothing rather than "$0".
 */
export function formatPlanPrice(price: PlanPriceInput): { amount: string; per: string } | null {
  if (price.unit_amount == null) return null;
  const wholeDollars = price.unit_amount % 100 === 0;
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currency.toUpperCase(),
    minimumFractionDigits: wholeDollars ? 0 : 2,
    maximumFractionDigits: wholeDollars ? 0 : 2,
  }).format(price.unit_amount / 100);

  if (!price.recurring) return { amount, per: "one-time" };
  const { interval, interval_count } = price.recurring;
  const per = interval_count === 1 ? `per ${interval}` : `every ${interval_count} ${interval}s`;
  return { amount, per };
}
