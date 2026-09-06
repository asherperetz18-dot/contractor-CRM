import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canViewFinancials,
  canViewProfitLoss,
  FINANCIALS_ALWAYS_ROLES,
  PROFIT_LOSS_ALWAYS_ROLES,
} from "./accounting-access.ts";
import type { AppRole } from "./types.ts";

/**
 * The Accounting switches: who may see company money.
 *
 * Pinned rather than assumed, because both directions are expensive. A
 * rep who can read the company's profit is a leak; an owner or
 * bookkeeper locked out of the bills the morning after a migration is an
 * outage. The FALSE default in 0127 is only safe because the role check
 * runs before the flag, so that ordering is tested here directly.
 */

function member(
  roles: AppRole[],
  flags: Partial<{ financials: boolean; pnl: boolean }> = {}
) {
  return {
    roles,
    can_view_financials: flags.financials ?? false,
    can_view_profit_loss: flags.pnl ?? false,
  };
}

// -- View Financials ------------------------------------------------

test("the money roles always see financials, switch or no switch", () => {
  for (const role of FINANCIALS_ALWAYS_ROLES) {
    assert.equal(canViewFinancials(member([role])), true, role);
    assert.equal(canViewFinancials(member([role], { financials: false })), true, role);
  }
});

test("everyone else starts with no access", () => {
  assert.equal(canViewFinancials(member(["Sales"])), false);
  assert.equal(canViewFinancials(member(["Field"])), false);
  assert.equal(canViewFinancials(member(["Production"])), false);
  assert.equal(canViewFinancials(member(["Call Center"])), false);
  assert.equal(canViewFinancials(member(["Dispatch"])), false);
});

test("the switch grants access to someone who had none", () => {
  assert.equal(canViewFinancials(member(["Sales"], { financials: true })), true);
});

test("before migration 0127 the columns are undefined, and undefined is off", () => {
  assert.equal(canViewFinancials({ roles: ["Sales"] }), false);
  // ...but the roles that hold it by role still hold it, which is what
  // makes the FALSE default safe to run on a live company.
  assert.equal(canViewFinancials({ roles: ["Office"] }), true);
  assert.equal(canViewFinancials({ roles: ["Bookkeeping"] }), true);
});

test("holding a money role alongside an ordinary one keeps the access", () => {
  assert.equal(canViewFinancials(member(["Sales", "Office"])), true);
});

test("nobody signed in, nothing shown", () => {
  assert.equal(canViewFinancials(null), false);
});

// -- View Profit & Loss ---------------------------------------------

test("Office and Admin always read the P&L", () => {
  for (const role of PROFIT_LOSS_ALWAYS_ROLES) {
    assert.equal(canViewProfitLoss(member([role])), true, role);
    assert.equal(canViewProfitLoss(member([role], { pnl: false })), true, role);
  }
});

test("Bookkeeping runs the money but is not shown profit until switched on", () => {
  assert.equal(canViewFinancials(member(["Bookkeeping"])), true);
  assert.equal(canViewProfitLoss(member(["Bookkeeping"])), false);
  assert.equal(canViewProfitLoss(member(["Bookkeeping"], { pnl: true })), true);
});

test("the P&L switch alone does nothing -- it needs financials underneath", () => {
  assert.equal(canViewProfitLoss(member(["Sales"], { pnl: true })), false);
  assert.equal(
    canViewProfitLoss(member(["Sales"], { financials: true, pnl: true })),
    true
  );
});

test("financials without the P&L switch is the split the owner asked for", () => {
  const collectsButSeesNoProfit = member(["Sales"], { financials: true, pnl: false });
  assert.equal(canViewFinancials(collectsButSeesNoProfit), true);
  assert.equal(canViewProfitLoss(collectsButSeesNoProfit), false);
});

test("nobody signed in, no P&L", () => {
  assert.equal(canViewProfitLoss(null), false);
});
