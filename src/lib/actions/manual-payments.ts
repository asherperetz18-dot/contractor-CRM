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
 * phase state, the lead card, and collectionsSummary. A second home for
 * cash would mean five places to reconcile and five chances to disagree
 * about money.
 *
 * Not idempotent by design, unlike the Stripe path: two identical cash
 * payments on the same day are a real thing, so this cannot dedupe them
 * on amount. recorded_by is what makes that safe to allow.
 */
export async function recordManualPayment(
  input: ManualPaymentInput
): Promise<{ error?: string; warning?: string; ok?: boolean }> {
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
    // California caps a home-improvement down payment at $1,000 or 10%,
    // whichever is less -- and the cap does not care that the customer
    // paid in cash.
    const legalCap = depositCents(
      estimate.total_cents,
      estimate.deposit_percent_bp,
      estimate.deposit_cap_cents
    );
    if (legalCap > 0 && amountCents > legalCap) {
      warnings.push(
        `The deposit limit on this contract is ${moneyCents(legalCap)} (10% or $1,000, whichever is less).`
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

  revalidatePath("/payments");
  revalidatePath(`/estimates/${estimate.id}`);
  revalidatePath("/pipeline");
  return { ok: true, warning: warnings.join(" ") || undefined };
}

/** Undo a mis-keyed entry. Stripe rows are never touched from here. */
export async function deleteManualPayment(
  paymentId: string
): Promise<{ error?: string; ok?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can do that." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("portal_payments")
    .delete()
    .eq("id", paymentId)
    .eq("company_id", profile.company_id)
    // Deleting a Stripe row would put this app's record out of step with
    // money that actually moved. Those get refunded in Stripe instead.
    .eq("source", "manual")
    .select("id, estimate_id");
  if (error) return { error: error.message };
  if (!data?.length) {
    return { error: "That payment can't be removed here — Stripe payments are refunded in Stripe." };
  }

  revalidatePath("/payments");
  revalidatePath(`/estimates/${data[0].estimate_id}`);
  return { ok: true };
}
