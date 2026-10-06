"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { canManageBills } from "@/lib/data/types";

/**
 * Gives a credit on a bill (DECISIONS #154): lowers what the customer
 * owes on it without money moving -- a discount after the fact, goodwill.
 * The database checks and writes it in one step (give_bill_credit, 0209):
 * a billed bill on a signed contract or an issued invoice, never more
 * than is still owed. Gated like recording a payment: it's the company's
 * money.
 */
export async function giveBillCredit(input: {
  phaseId: string;
  amountCents: number;
  reason: string;
}): Promise<{ error?: string; ok?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) {
    return { error: "Only Bookkeeping, Office or Admin users can give a credit." };
  }
  const amountCents = Math.round(input.amountCents);
  if (!Number.isFinite(amountCents) || amountCents <= 0) return { error: "Enter an amount greater than zero." };
  const reason = input.reason.trim();
  if (!reason) return { error: "Say why the credit is given — the customer sees it on their statement." };

  const admin = createAdminClient();
  const { data: phase } = await admin
    .from("estimate_payments")
    .select("estimate_id")
    .eq("id", input.phaseId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ estimate_id: string }>();
  if (!phase) return { error: "That bill no longer exists." };

  const { error } = await admin.rpc("give_bill_credit", {
    p_company: profile.company_id,
    p_phase: input.phaseId,
    p_amount: amountCents,
    p_reason: reason,
    p_by: profile.id,
  });
  if (error) {
    if (/give_bill_credit/.test(error.message) || error.code === "PGRST202") {
      return { error: "Credits need a database update first: run 0209_bill_credits.sql in Supabase." };
    }
    return { error: error.message };
  }

  revalidatePath(`/estimates/${phase.estimate_id}`);
  revalidatePath("/invoices");
  revalidatePath("/collect");
  revalidatePath("/payments");
  return { ok: true };
}
