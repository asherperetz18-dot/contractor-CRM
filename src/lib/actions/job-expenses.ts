"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import type { JobExpense, JobExpenseInput } from "@/lib/data/types";

const COLUMNS =
  "id, company_id, lead_id, estimate_payment_id, vendor, vendor_id, category, description, " +
  "amount_cents, spent_on, source, qb_txn_id, qb_txn_type, qb_project_id, created_at";

/**
 * Every cost recorded against one job, newest first.
 *
 * Keyed on the lead rather than the estimate: a job's costs do not
 * belong to one document. A contract, its change orders and its
 * completion all draw on the same pile of materials and the same crew,
 * and a bathroom that went over on tile went over once, not once per
 * document it might be filed under.
 */
export async function getJobExpenses(
  leadId: string
): Promise<{ error?: string; expenses?: JobExpense[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  // selectAll rather than a bare select: a long job with a lot of
  // receipts would otherwise stop at 1000 and understate its own cost,
  // which is the one number this whole feature exists to get right.
  const rows = await selectAll<JobExpense>((from, to) =>
    supabase
      .from("job_expenses")
      .select(COLUMNS)
      .eq("lead_id", leadId)
      .eq("company_id", profile.company_id)
      .order("spent_on", { ascending: false })
      .range(from, to)
  );
  return { expenses: rows };
}

export async function createJobExpense(
  input: JobExpenseInput
): Promise<{ error?: string; id?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const amount = Math.round(Number(input.amountCents) || 0);
  if (!amount) return { error: "Enter an amount." };
  if (!input.spentOn) return { error: "Enter the date it was spent." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_expenses")
    .insert({
      company_id: profile.company_id,
      lead_id: input.leadId,
      estimate_payment_id: input.estimatePaymentId || null,
      vendor_id: input.vendorId || null,
      // Only kept when no vendor record was picked. Storing both would
      // be two names for one supplier, free to drift apart the moment
      // somebody corrects the vendor record.
      vendor: input.vendorId ? null : input.vendor?.trim() || null,
      category: input.category?.trim() || null,
      description: input.description?.trim() || null,
      amount_cents: amount,
      spent_on: input.spentOn,
      source: "manual",
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/estimates");
  return { id: (data as { id: string }).id };
}

/**
 * Files an expense against a phase, or moves it back to unassigned.
 *
 * Company-scoped and checked by row count. Matching on id alone would
 * take whatever id arrived, and a server action is reachable directly --
 * so another company's cost would be one guessed uuid from being moved
 * onto a job it has nothing to do with.
 */
export async function assignExpensePhase(
  expenseId: string,
  estimatePaymentId: string | null
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_expenses")
    .update({ estimate_payment_id: estimatePaymentId || null, updated_at: new Date().toISOString() })
    .eq("id", expenseId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That cost couldn't be updated." };

  revalidatePath("/estimates");
  return {};
}

export async function deleteJobExpense(expenseId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_expenses")
    .delete()
    .eq("id", expenseId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That cost couldn't be deleted." };

  revalidatePath("/estimates");
  return {};
}
