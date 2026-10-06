"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canManageBills,
  depositCents,
  isAdminRole,
  moneyCents,
  type EstimateStatus,
  type ManualPaymentMethod,
} from "@/lib/data/types";
import { manualClearUpdate } from "@/lib/data/manual-clear";
import { manualEditUpdate, type ManualEditInput } from "@/lib/data/manual-edit";
import { depositRuleSentence } from "@/lib/deposit-rule";
import { sendPaymentReceipt } from "@/lib/send-receipt";

export type ManualPaymentInput = {
  estimateId: string;
  /** Which schedule phase this settles. Omit for the deposit. */
  phaseId?: string | null;
  amountCents: number;
  method: ManualPaymentMethod;
  /** Cheque number, transfer reference, whatever proves it later. */
  reference?: string;
  note?: string;
  /**
   * A cheque taken but not yet banked is not money. False files it as
   * clearing, the same bucket ACH sits in, so "Clearing" keeps meaning
   * "promised, not arrived" whatever the method.
   */
  cleared?: boolean;
  /** When it was actually taken, which is often not today. */
  receivedOn?: string;
  /** Email the customer a receipt (DECISIONS #151). Only for money that
   *  has arrived: a cheque not yet banked gets one from Payments later. */
  sendReceipt?: boolean;
};

type EstimateRow = {
  id: string;
  company_id: string;
  lead_id: string;
  doc_number: string;
  status: EstimateStatus;
  total_cents: number;
  deposit_cents: number | null;
  deposit_percent_bp: number;
  deposit_cap_cents: number;
};

/**
 * Records money taken outside Stripe -- cash, a cheque, a bank transfer.
 *
 * Written into portal_payments rather than a table of its own. Five
 * places already read that table to answer "what has this job been
 * paid": the Payments page, the PAID stamp on the contract, progress
 * phase state, the lead card, and the projects rollup. A second home for
 * cash would mean five places to reconcile and five chances to disagree
 * about money.
 *
 * Not idempotent by design, unlike the Stripe path: two identical cash
 * payments on the same day are a real thing, so this cannot dedupe them
 * on amount. recorded_by is what makes that safe to allow.
 */
export async function recordManualPayment(
  input: ManualPaymentInput
): Promise<{ error?: string; warning?: string; ok?: boolean; receiptSentTo?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  // Money entry sits with the people who chase it. Cash recorded by
  // anyone, with no trail, is how money goes missing. Bookkeeping
  // joined when Money to Collect shipped -- reconciling what arrived
  // is the role's whole job.
  if (!canManageBills(profile)) {
    return { error: "Only Bookkeeping, Office or Admin users can record a payment." };
  }

  const amountCents = Math.round(input.amountCents);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { error: "Enter an amount greater than zero." };
  }

  const admin = createAdminClient();
  const { data: estimate } = await admin
    .from("estimates")
    .select(
      "id, company_id, lead_id, doc_number, status, total_cents, deposit_cents, deposit_percent_bp, deposit_cap_cents"
    )
    .eq("id", input.estimateId)
    .eq("company_id", profile.company_id)
    .maybeSingle<EstimateRow>();
  if (!estimate) return { error: "Contract not found." };
  if (estimate.status !== "Signed") {
    return { error: "This estimate isn't signed yet, so there's nothing to collect against." };
  }

  // A phase, if given, must belong to this contract -- otherwise a
  // payment could be filed against another job's schedule.
  if (input.phaseId) {
    const { data: phase } = await admin
      .from("estimate_payments")
      .select("id")
      .eq("id", input.phaseId)
      .eq("estimate_id", estimate.id)
      .maybeSingle();
    if (!phase) return { error: "That payment phase isn't on this contract." };
  }

  const { data: existing } = await admin
    .from("portal_payments")
    .select("amount_cents, status")
    .eq("estimate_id", estimate.id)
    .returns<{ amount_cents: number; status: string }[]>();
  const alreadyPaid = (existing ?? [])
    .filter((p) => p.status === "succeeded")
    .reduce((sum, p) => sum + p.amount_cents, 0);

  // Warnings, not refusals: the contractor is looking at the money and
  // this app is not. Blocking a real payment because a total looks odd
  // just means it gets recorded somewhere worse, or not at all.
  const warnings: string[] = [];
  if (alreadyPaid + amountCents > estimate.total_cents) {
    warnings.push(
      `That takes the total collected to ${moneyCents(alreadyPaid + amountCents)} on a ${moneyCents(estimate.total_cents)} contract.`
    );
  }
  if (!input.phaseId) {
    // The deposit rule copied onto the estimate (the company's own; for a
    // California company, the legal limit of $1,000 or 10%) -- and the cap
    // does not care that the customer paid in cash.
    const legalCap = depositCents(
      estimate.total_cents,
      estimate.deposit_percent_bp,
      estimate.deposit_cap_cents
    );
    if (legalCap > 0 && amountCents > legalCap) {
      warnings.push(
        `The deposit limit on this contract is ${moneyCents(legalCap)} (${depositRuleSentence({
          percentBp: estimate.deposit_percent_bp,
          capCents: estimate.deposit_cap_cents,
        })}).`
      );
    }
  }

  const receivedAt = input.receivedOn
    ? new Date(`${input.receivedOn}T12:00:00`).toISOString()
    : new Date().toISOString();
  const cleared = input.cleared !== false;

  const { data: inserted, error } = await admin
    .from("portal_payments")
    .insert({
      company_id: estimate.company_id,
      estimate_id: estimate.id,
      estimate_payment_id: input.phaseId || null,
      lead_id: estimate.lead_id,
      kind: input.phaseId ? "progress" : "deposit",
      amount_cents: amountCents,
      status: cleared ? "succeeded" : "pending",
      method: input.method,
      source: "manual",
      recorded_by: profile.id,
      reference: input.reference?.trim() || null,
      note: input.note?.trim() || null,
      paid_at: cleared ? receivedAt : null,
      created_at: receivedAt,
    })
    .select("id");
  // Row count rather than a missing error: a blocked insert returns no
  // rows and raises nothing.
  if (error || !inserted?.length) {
    return { error: error?.message || "Could not record the payment." };
  }

  // The payment stands whatever happens to the email.
  let receiptSentTo: string | undefined;
  if (input.sendReceipt && cleared) {
    const receipt = await sendPaymentReceipt(admin, String(inserted[0].id), estimate.company_id, {
      automatic: false,
      sentBy: profile.id,
    });
    if (receipt.error) warnings.push(`No receipt went out: ${receipt.error}`);
    receiptSentTo = receipt.sentTo;
  }

  revalidatePath("/payments");
  revalidatePath(`/estimates/${estimate.id}`);
  revalidatePath("/pipeline");
  return { ok: true, warning: warnings.join(" ") || undefined, receiptSentTo };
}

/**
 * Email the customer a receipt for a payment that has arrived, online or
 * by hand -- the first one, or again for a customer who lost it
 * (DECISIONS #151). Gated like recording a payment.
 */
export async function emailPaymentReceipt(paymentId: string): Promise<{ error?: string; sentTo?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) {
    return { error: "Only Bookkeeping, Office or Admin users can send a receipt." };
  }
  const admin = createAdminClient();
  const result = await sendPaymentReceipt(admin, paymentId, profile.company_id, { automatic: false, sentBy: profile.id });
  if (result.error) return { error: result.error };
  revalidatePath("/payments");
  return { sentTo: result.sentTo };
}

/**
 * The cheque was banked, the transfer landed: the pending row becomes
 * the settled one.
 *
 * Without this, the only way to settle a payment recorded as "not yet
 * cleared" was to record it again as received -- which left both rows in
 * the history, the same money showing twice. Stripe rows are excluded:
 * those settle from the webhook when the bank confirms, and marking one
 * by hand would say money arrived that Stripe never confirmed.
 */
export async function markManualPaymentCleared(
  paymentId: string,
  /** The day it actually landed, if not today. */
  clearedOn?: string
): Promise<{ error?: string; ok?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) {
    return { error: "Only Bookkeeping, Office or Admin users can record a payment." };
  }

  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("portal_payments")
    .select("id, estimate_id, source, status")
    .eq("id", paymentId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; estimate_id: string; source: string; status: string }>();
  if (!payment) return { error: "Payment not found." };

  const decision = manualClearUpdate(payment, clearedOn);
  if ("error" in decision) return { error: decision.error };

  const { data: updated, error } = await admin
    .from("portal_payments")
    .update({ ...decision.update, updated_at: new Date().toISOString() })
    .eq("id", payment.id)
    .eq("company_id", profile.company_id)
    // Re-stated on the write so a concurrent settle or a Stripe row can
    // never slip through between the read above and this update.
    .eq("source", "manual")
    .eq("status", "pending")
    .select("id");
  if (error || !updated?.length) {
    return { error: error?.message || "Could not update the payment." };
  }

  revalidatePath("/payments");
  revalidatePath(`/estimates/${payment.estimate_id}`);
  revalidatePath("/pipeline");
  return { ok: true };
}

/**
 * Fix a hand-recorded payment in place: the cheque number, the method,
 * the amount, the day it was taken.
 *
 * Before this, the only remedy for a typo was delete-and-record-again --
 * which needs Office/Admin and loses recorded_by, the trail that makes
 * cash entry safe to allow at all. Stripe rows stay untouchable: their
 * record is what actually moved through Stripe.
 */
export async function updateManualPayment(
  paymentId: string,
  input: ManualEditInput
): Promise<{ error?: string; ok?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) {
    return { error: "Only Bookkeeping, Office or Admin users can edit a payment." };
  }

  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("portal_payments")
    .select("id, estimate_id, source, status, amount_cents")
    .eq("id", paymentId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; estimate_id: string; source: string; status: string; amount_cents: number }>();
  if (!payment) return { error: "Payment not found." };
  // A refund (DECISIONS #155) isn't edited: remove it and record it again.
  if (payment.amount_cents < 0) return { error: "A refund can't be edited. Remove it and record it again." };

  const decision = manualEditUpdate(payment, input);
  if ("error" in decision) return { error: decision.error };
  // Never below what has been refunded of it.
  if (decision.update.amount_cents !== undefined) {
    const refunded = await refundedOfCents(admin, payment.id);
    if (decision.update.amount_cents < refunded) {
      return { error: `${moneyCents(refunded)} of this payment has been refunded, so it can't be less than that.` };
    }
  }

  const { data: updated, error } = await admin
    .from("portal_payments")
    .update({ ...decision.update, updated_at: new Date().toISOString() })
    .eq("id", payment.id)
    .eq("company_id", profile.company_id)
    // Re-stated on the write so a Stripe row can never slip through
    // between the read above and this update.
    .eq("source", "manual")
    .select("id");
  if (error || !updated?.length) {
    return { error: error?.message || "Could not update the payment." };
  }

  revalidatePath("/payments");
  revalidatePath(`/estimates/${payment.estimate_id}`);
  revalidatePath("/pipeline");
  return { ok: true };
}

/** Undo a mis-keyed entry. Stripe rows are never touched from here. */
export async function deleteManualPayment(
  paymentId: string
): Promise<{ error?: string; ok?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can do that." };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("portal_payments")
    .select("id, estimate_id, amount_cents")
    .eq("id", paymentId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; estimate_id: string; amount_cents: number }>();
  if (!row) return { error: "Payment not found." };

  // A refund recorded by mistake (DECISIONS #155): out with the credit
  // that came with it, in one step. A Stripe refund is Stripe's.
  if (row.amount_cents < 0) {
    const { error: removeError } = await admin.rpc("remove_refund", {
      p_company: profile.company_id,
      p_refund: row.id,
    });
    if (removeError) return { error: removeError.message };
    revalidatePath("/payments");
    revalidatePath(`/estimates/${row.estimate_id}`);
    return { ok: true };
  }

  const { data, error } = await admin
    .from("portal_payments")
    .delete()
    .eq("id", paymentId)
    .eq("company_id", profile.company_id)
    // Deleting a Stripe row would put this app's record out of step with
    // money that actually moved. Those get refunded in Stripe instead.
    .eq("source", "manual")
    .select("id, estimate_id");
  if (error) {
    // Refunds point at it (0210): they go first.
    if (error.code === "23503") return { error: "This payment has refunds recorded against it. Remove those first." };
    return { error: error.message };
  }
  if (!data?.length) {
    return { error: "That payment can't be removed here — Stripe payments are refunded in Stripe." };
  }

  revalidatePath("/payments");
  revalidatePath(`/estimates/${data[0].estimate_id}`);
  return { ok: true };
}

/** What has been refunded of a payment, going or gone through (0 before 0210). */
async function refundedOfCents(admin: ReturnType<typeof createAdminClient>, paymentId: string): Promise<number> {
  const { data, error } = await admin
    .from("portal_payments")
    .select("amount_cents")
    .eq("refund_of", paymentId)
    .in("status", ["pending", "succeeded"])
    .returns<{ amount_cents: number }[]>();
  if (error) return 0;
  return (data ?? []).reduce((sum, r) => sum - r.amount_cents, 0);
}

const REFUNDS_NEED_0210 = "Refunds need a database update first: run 0210_payment_refunds.sql in Supabase.";

export type RefundInput = {
  /** The payment the money goes back on. */
  paymentId: string;
  amountCents: number;
  /** Why -- the customer sees it on their statement. */
  reason: string;
  /** How it went back, when not the way it came in. */
  method?: string | null;
  reference?: string;
  /** The day it went back, if not today. */
  refundedOn?: string;
  /**
   * Does the customer still owe what was refunded? No (the usual case):
   * a credit for it goes with the refund, so the bill doesn't come back.
   * Yes (a bounced check): the bill is owed again. Ignored on a deposit.
   */
  stillOwed: boolean;
};

/**
 * Records money given back to a customer outside Stripe -- a check, cash,
 * a transfer (DECISIONS #155). Written with its credit in one step by the
 * database (record_refund): never more than is left of the payment, on
 * money that has arrived. A refund made in Stripe records itself.
 */
export async function recordRefund(input: RefundInput): Promise<{ error?: string; ok?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) {
    return { error: "Only Bookkeeping, Office or Admin users can record a refund." };
  }
  const amountCents = Math.round(input.amountCents);
  if (!Number.isFinite(amountCents) || amountCents <= 0) return { error: "Enter an amount greater than zero." };
  const reason = input.reason.trim();
  if (!reason) return { error: "Say why — the customer sees it on their statement." };

  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("portal_payments")
    .select("id, estimate_id")
    .eq("id", input.paymentId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; estimate_id: string }>();
  if (!payment) return { error: "Payment not found." };

  const { error } = await admin.rpc("record_refund", {
    p_company: profile.company_id,
    p_payment: payment.id,
    p_amount: amountCents,
    p_reason: reason,
    p_by: profile.id,
    p_still_owed: input.stillOwed,
    p_method: input.method || null,
    p_reference: input.reference?.trim() || null,
    p_refunded_at: input.refundedOn ? new Date(`${input.refundedOn}T12:00:00`).toISOString() : null,
  });
  if (error) {
    if (/record_refund/.test(error.message) || error.code === "PGRST202") return { error: REFUNDS_NEED_0210 };
    return { error: error.message };
  }

  revalidatePath("/payments");
  revalidatePath(`/estimates/${payment.estimate_id}`);
  revalidatePath("/invoices");
  revalidatePath("/collect");
  return { ok: true };
}

/**
 * Decides a refund made in Stripe (DECISIONS #155): does the customer
 * still owe what was refunded? No: a credit for it. Yes: the bill is owed
 * again. Asked once, after the refund has gone through.
 */
export async function decideRefund(refundId: string, stillOwed: boolean): Promise<{ error?: string; ok?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) {
    return { error: "Only Bookkeeping, Office or Admin users can do that." };
  }
  const admin = createAdminClient();
  const { data: refund } = await admin
    .from("portal_payments")
    .select("id, estimate_id")
    .eq("id", refundId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; estimate_id: string }>();
  if (!refund) return { error: "Refund not found." };

  const { error } = await admin.rpc("decide_refund", {
    p_company: profile.company_id,
    p_refund: refund.id,
    p_still_owed: stillOwed,
    p_by: profile.id,
  });
  if (error) {
    if (/decide_refund/.test(error.message) || error.code === "PGRST202") return { error: REFUNDS_NEED_0210 };
    return { error: error.message };
  }

  revalidatePath("/payments");
  revalidatePath(`/estimates/${refund.estimate_id}`);
  revalidatePath("/invoices");
  revalidatePath("/collect");
  return { ok: true };
}
