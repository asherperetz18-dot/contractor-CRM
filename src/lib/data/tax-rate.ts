/**
 * The company sales-tax rate as the Company Profile page edits it.
 *
 * It is stored in basis points (950 = 9.50%, see migration 0059) because a
 * floating-point rate drifts by a cent on a document the customer signs.
 * The form shows and takes a plain percent ("9.5"), and these two
 * functions are the only place that conversion happens, so 9.5 -> 950 ->
 * "9.5" round-trips exactly.
 */

/** 100%, the most a rate can be. */
export const MAX_TAX_RATE_BP = 10000;

/** "9.5" -> 950. Blank means no tax (0). Null for anything that is not a
 *  rate between 0 and 100 -- letters, negatives, "150". */
export function taxRateInputToBp(input: string): number | null {
  const trimmed = input.trim().replace(/%$/, "").trim();
  if (trimmed === "") return 0;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const bp = Math.round(Number(trimmed) * 100);
  if (!Number.isFinite(bp) || bp < 0 || bp > MAX_TAX_RATE_BP) return null;
  return bp;
}

/** 950 -> "9.5", 725 -> "7.25", 0 -> "" (the field shows empty, not "0"). */
export function taxRateBpToInput(bp: number | null | undefined): string {
  const n = Number(bp) || 0;
  if (n <= 0) return "";
  const pct = n / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** "9.50%" for display next to a total. */
export function taxRateLabel(bp: number | null | undefined): string {
  return `${((Number(bp) || 0) / 100).toFixed(2)}%`;
}
