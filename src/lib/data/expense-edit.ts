/**
 * Editing a job cost after it was saved -- the "Already paid" receipt
 * whose amount, vendor or job was entered wrong. Pure rules, shared by
 * the edit window and the server action that enforces them.
 */

/**
 * Who gets Edit: exactly the roles the job_expenses write policy lets
 * through (can_manage_costs_in_company -- Office, Admin, Bookkeeping,
 * Production). Field can record a receipt but not change one, so a
 * button shown to them would only ever fail.
 */
export function canEditJobCosts(profile: { roles: readonly string[] } | null): boolean {
  if (!profile) return false;
  return ["Office", "Admin", "Bookkeeping", "Production"].some((r) => profile.roles.includes(r));
}

/**
 * Why a cost can't be edited here, or null when it can. A QuickBooks
 * row is rewritten by the next sync, and a cost written by paying a
 * bill is that payment's record -- it's changed through the bill.
 */
export function expenseEditLock(expense: { source: string }): string | null {
  if (expense.source === "quickbooks") return "Synced from QuickBooks";
  if (expense.source === "bill") return "Paid from Bills to Pay";
  return null;
}

export type JobExpenseEdit = {
  leadId: string;
  /** A vendor record, or "" for a typed name. */
  vendorId: string;
  vendor: string;
  description: string;
  amountCents: number;
  spentOn: string;
  /** The phase picked under "Which contract?" ("" = not filed). Left
   *  out when the window offered no choice (a one-contract customer). */
  estimatePaymentId?: string;
};

export type JobExpensePatch = {
  lead_id: string;
  estimate_payment_id: string | null;
  vendor_id: string | null;
  vendor: string | null;
  description: string | null;
  amount_cents: number;
  spent_on: string;
};

export function jobExpensePatch(
  input: JobExpenseEdit,
  current: { lead_id: string; estimate_payment_id: string | null }
): { error: string } | { patch: JobExpensePatch } {
  const amount = Math.round(Number(input.amountCents) || 0);
  if (!input.leadId) return { error: "Pick the job this belongs to." };
  if (!amount) return { error: "Enter the amount." };
  if (!input.spentOn) return { error: "Enter the date it was paid." };
  return {
    patch: {
      lead_id: input.leadId,
      // A phase is one job's payment row; carried onto another job it
      // would file the cost under a contract it has nothing to do with.
      estimate_payment_id:
        input.estimatePaymentId !== undefined
          ? input.estimatePaymentId || null
          : input.leadId === current.lead_id
            ? current.estimate_payment_id
            : null,
      vendor_id: input.vendorId || null,
      // One name per supplier, same rule as createJobExpense.
      vendor: input.vendorId ? null : input.vendor.trim() || null,
      description: input.description.trim() || null,
      amount_cents: amount,
      spent_on: input.spentOn,
    },
  };
}
