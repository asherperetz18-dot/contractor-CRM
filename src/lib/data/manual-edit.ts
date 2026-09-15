import { MANUAL_PAYMENT_METHODS } from "./types.ts";

/**
 * The decision behind editing a hand-recorded payment in place.
 *
 * A cheque number left off, a fat-fingered amount, the wrong day picked:
 * until now the only fix was delete-and-record-again, which needs
 * Office/Admin and loses who originally recorded it. This builds the
 * update for fixing the row where it sits.
 *
 * Pure and separate from the server action so the rules are testable,
 * the same split as manual-clear.ts: only hand-recorded rows qualify
 * (editing a Stripe row would put this app out of step with money that
 * actually moved), amounts stay above zero, and a re-dated payment only
 * gets a paid date if it has actually settled.
 */
export type ManualEditInput = {
  amountCents?: number;
  method?: string;
  /** Cheque number or transfer reference. "" clears it. */
  reference?: string;
  note?: string;
  /** The day it was actually taken (YYYY-MM-DD). */
  receivedOn?: string;
};

export type ManualEditUpdate = {
  amount_cents?: number;
  method?: string;
  reference?: string | null;
  note?: string | null;
  created_at?: string;
  paid_at?: string;
};

export function manualEditUpdate(
  payment: { source: string; status: string },
  input: ManualEditInput
): { error: string } | { update: ManualEditUpdate } {
  if (payment.source !== "manual") {
    return { error: "Stripe payments carry Stripe's own record — they can't be edited here." };
  }

  const update: ManualEditUpdate = {};

  if (input.amountCents !== undefined) {
    const amount = Math.round(input.amountCents);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: "Enter an amount greater than zero." };
    }
    update.amount_cents = amount;
  }

  if (input.method !== undefined) {
    if (!(MANUAL_PAYMENT_METHODS as readonly string[]).includes(input.method)) {
      return { error: "That isn't a payment method this app knows." };
    }
    update.method = input.method;
  }

  if (input.reference !== undefined) update.reference = input.reference.trim() || null;
  if (input.note !== undefined) update.note = input.note.trim() || null;

  if (input.receivedOn !== undefined) {
    // Noon, matching how recordManualPayment files a received-on date,
    // so a date never slips a day across timezones.
    const receivedAt = new Date(`${input.receivedOn}T12:00:00`);
    if (Number.isNaN(receivedAt.getTime())) {
      return { error: "That received-on date doesn't parse." };
    }
    update.created_at = receivedAt.toISOString();
    // A pending row hasn't landed; a paid date would count it as money.
    if (payment.status === "succeeded") update.paid_at = receivedAt.toISOString();
  }

  if (Object.keys(update).length === 0) return { error: "Nothing to change." };
  return { update };
}
