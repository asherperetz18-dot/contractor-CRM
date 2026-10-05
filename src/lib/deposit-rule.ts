/**
 * The deposit a company asks for at signing: a percent of the total, held
 * under an optional dollar cap -- whichever is less (DECISIONS #117).
 *
 * Each company sets its own (Settings → Contracts); it is copied onto
 * every new estimate, so changing it never changes one already created.
 * It used to be California's legal limit for everyone, wherever they
 * worked. A California company still can't set more than that limit.
 *
 * Pure, so it is tested on its own (deposit-rule.test.ts). The deposit
 * itself is worked out by depositCents in data/types.
 */

export type DepositRule = {
  /** Percent of the total, in basis points: 1000 = 10%. */
  percentBp: number;
  /** Dollar ceiling in cents; 0 = no cap. */
  capCents: number;
};

/**
 * California Business and Professions Code 7159.5: the down payment on a
 * home improvement contract may not exceed $1,000 or 10% of the contract
 * price, whichever is less.
 */
export const CALIFORNIA_DEPOSIT_LIMIT: DepositRule = { percentBp: 1000, capCents: 100000 };

export function isCaliforniaState(state: string | null | undefined): boolean {
  const s = (state ?? "").trim().toLowerCase();
  return s === "ca" || s === "california";
}

/** "10" → 1000 bp; "$1,000" → 100000 cents; a blank cap is no cap. */
export function parseDepositRule(percentText: string, capText: string): { rule: DepositRule } | { error: string } {
  const percent = Number(percentText.replace(/[%\s]/g, ""));
  if (percentText.trim() === "" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    return { error: "The deposit percent must be a number from 0 to 100." };
  }
  const capClean = capText.replace(/[$,\s]/g, "");
  const cap = capClean === "" ? 0 : Number(capClean);
  if (!Number.isFinite(cap) || cap < 0) {
    return { error: "The cap must be a dollar amount, or left blank for no cap." };
  }
  return { rule: { percentBp: Math.round(percent * 100), capCents: Math.round(cap * 100) } };
}

/** Null when the rule is fine for a company in this state. */
export function depositRuleProblem(rule: DepositRule, state: string | null | undefined): string | null {
  if (!Number.isInteger(rule.percentBp) || rule.percentBp < 0 || rule.percentBp > 10000) {
    return "The deposit percent must be a number from 0 to 100.";
  }
  if (!Number.isInteger(rule.capCents) || rule.capCents < 0) {
    return "The cap must be a dollar amount, or left blank for no cap.";
  }
  if (isCaliforniaState(state)) {
    const limit = CALIFORNIA_DEPOSIT_LIMIT;
    if (rule.percentBp > limit.percentBp || rule.capCents === 0 || rule.capCents > limit.capCents) {
      return "California limits the deposit on a home improvement contract to $1,000 or 10% of the price, whichever is less. Use 10% or less, with a cap of $1,000 or less.";
    }
  }
  return null;
}

const dollars = (cents: number) =>
  "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });

/** "10% of the total, up to $1,000". */
export function depositRuleSentence(rule: DepositRule): string {
  if (rule.percentBp <= 0) return "no deposit";
  const percent = `${Number((rule.percentBp / 100).toFixed(2))}% of the total`;
  return rule.capCents > 0 ? `${percent}, up to ${dollars(rule.capCents)}` : `${percent}, with no cap`;
}
