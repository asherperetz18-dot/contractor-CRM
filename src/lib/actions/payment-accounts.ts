"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canManageBills, canManageCosts } from "@/lib/data/types";
import type { PaymentAccount } from "@/lib/data/bills";

const COLUMNS = "id, name, kind, last4, qb_account_id, archived_at";

/** A missing table means migration 0176 hasn't been run yet. */
const notReady = (message: string) => /payment_accounts|schema cache|does not exist/i.test(message);

/**
 * The company's "paid from" list. ready is false until migration 0176
 * runs -- the bill form then simply has no "Paid from" choice.
 */
export async function getPaymentAccounts(
  includeArchived = false
): Promise<{ error?: string; ready: boolean; accounts: PaymentAccount[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in.", ready: false, accounts: [] };
  if (!canManageCosts(profile)) return { ready: false, accounts: [] };

  const supabase = await createClient();
  let q = supabase
    .from("payment_accounts")
    .select(COLUMNS)
    .eq("company_id", profile.company_id)
    .order("name");
  if (!includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) {
    return notReady(error.message)
      ? { ready: false, accounts: [] }
      : { error: error.message, ready: false, accounts: [] };
  }
  return { ready: true, accounts: (data ?? []) as PaymentAccount[] };
}

export async function savePaymentAccount(input: {
  id?: string;
  name: string;
  kind: PaymentAccount["kind"];
  last4: string;
}): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) return { error: "Bookkeeping, Office or Admin only." };

  const name = input.name.trim();
  if (!name) return { error: "Name the account." };
  if (!["bank", "credit_card", "cash"].includes(input.kind)) return { error: "Pick the type." };
  const last4 = input.last4.replace(/\D/g, "").slice(-4) || null;

  const supabase = await createClient();
  const row = { name, kind: input.kind, last4, updated_at: new Date().toISOString() };
  const { error } = input.id
    ? await supabase
        .from("payment_accounts")
        .update(row)
        .eq("id", input.id)
        .eq("company_id", profile.company_id)
    : await supabase
        .from("payment_accounts")
        .insert({ ...row, company_id: profile.company_id, created_by: profile.id });
  if (error) {
    return {
      error: notReady(error.message)
        ? "Run supabase/migrations/0176_bill_payment_accounts.sql in the Supabase SQL editor first."
        : error.message,
    };
  }
  revalidatePath("/settings/payment-accounts");
  return {};
}

/** Archived, never deleted: past payments still name the account. */
export async function setPaymentAccountArchived(
  id: string,
  archived: boolean
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) return { error: "Bookkeeping, Office or Admin only." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payment_accounts")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That account couldn't be updated." };
  revalidatePath("/settings/payment-accounts");
  return {};
}
