/**
 * The decision behind "Mark cleared" on a pending manual payment.
 *
 * A cheque or transfer recorded before it landed sits as "pending"
 * (Clearing). There was no way to settle that row, so people recorded
 * the payment a second time as received -- and the history showed the
 * same money twice. This turns the existing row into the settled one.
 *
 * Pure and separate from the server action so the rules are testable:
 * only hand-recorded rows qualify (Stripe rows settle by webhook, and
 * touching one would put this app out of step with money that actually
 * moved), and only while still pending.
 */
export function manualClearUpdate(
  payment: { source: string; status: string },
  clearedOn?: string
): { error: string } | { update: { status: "succeeded"; paid_at: string } } {
  if (payment.source !== "manual") {
    return { error: "Stripe payments settle on their own once the bank confirms them." };
  }
  if (payment.status !== "pending") {
    return { error: "This payment is already settled." };
  }
  // Noon, matching how recordManualPayment files a received-on date, so
  // a date never slips a day across timezones.
  const paid_at = clearedOn
    ? new Date(`${clearedOn}T12:00:00`).toISOString()
    : new Date().toISOString();
  return { update: { status: "succeeded", paid_at } };
}
