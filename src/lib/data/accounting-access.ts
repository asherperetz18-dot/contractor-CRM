import type { AppRole } from "./types";

/**
 * Who may look at the company's money.
 *
 * Two rights, not one. Chasing an unpaid invoice and knowing what the
 * company earns are different jobs, and plenty of people should do the
 * first without the second -- so "View Financials" (Bills to Pay, Money
 * to Collect, Payments) and "View Profit & Loss" are separate switches
 * on Users & Roles.
 *
 * Both rules read the ROLE first and the switch second. That ordering is
 * the whole safety story of migration 0127: the columns default to FALSE,
 * and a false default would lock people out if the flag were the only
 * thing consulted. Because the roles whose job IS the money are checked
 * before the flag, the flag can only ever GRANT access to someone who did
 * not already have it. Nobody loses anything the day the migration runs.
 */

// Mirrors canManageBills in data/types -- the roles that hold financial
// access because the money is their job. Kept as a named list so the
// table can grey the switch out for exactly these people rather than
// offering a control that would appear to do nothing when flipped.
export const FINANCIALS_ALWAYS_ROLES: AppRole[] = ["Office", "Admin", "Bookkeeping"];

// Narrower. A bookkeeper runs the receivables and the bills; whether the
// owner wants them reading company profit is the owner's call, so
// Bookkeeping needs the switch here even though it never needs the one
// above.
export const PROFIT_LOSS_ALWAYS_ROLES: AppRole[] = ["Office", "Admin"];

/**
 * The part of a member this file reads. Deliberately a loose shape and
 * not Profile itself: the two columns arrive with migration 0127, and
 * until it runs they read as undefined rather than false.
 */
export type AccountingAccess = {
  roles: AppRole[];
  can_view_financials?: boolean;
  can_view_profit_loss?: boolean;
};

function holdsAny(profile: AccountingAccess, roles: AppRole[]): boolean {
  return (profile.roles ?? []).some((role) => roles.includes(role));
}

/**
 * Bills to Pay, Money to Collect, Payments.
 */
export function canViewFinancials(profile: AccountingAccess | null): boolean {
  if (!profile) return false;
  if (holdsAny(profile, FINANCIALS_ALWAYS_ROLES)) return true;
  // Explicit true only. undefined (column not there yet) reads as off,
  // which is the safe direction for money.
  return profile.can_view_financials === true;
}

/**
 * The Profit & Loss report.
 *
 * Requires View Financials underneath it, the same way Create Estimates
 * requires View. A P&L is built from the invoices and bills on those
 * screens, so granting the report to someone barred from its own numbers
 * would be a permission that contradicts itself.
 */
export function canViewProfitLoss(profile: AccountingAccess | null): boolean {
  if (!profile) return false;
  if (holdsAny(profile, PROFIT_LOSS_ALWAYS_ROLES)) return true;
  if (!canViewFinancials(profile)) return false;
  return profile.can_view_profit_loss === true;
}
