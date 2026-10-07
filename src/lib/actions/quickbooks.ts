"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { isAdminRole } from "@/lib/data/types";
import { encryptionAvailable, decryptSecret } from "@/lib/crypto/secrets";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { quickbooksCredentials, revokeQuickBooksToken } from "@/lib/quickbooks/oauth";
import { quickBooksAccess, readQbAccounts, readQuickBooksConnection } from "@/lib/quickbooks/connection";
import { accountChoices, categoryKey, costCategories, type QbAccount } from "@/lib/quickbooks/accounts";

/**
 * QuickBooks, step 1 (DECISIONS #171): the connection and the account
 * matches, for Settings › QuickBooks. Office or Admin, like the rest of
 * the company's settings. Nothing here writes to QuickBooks.
 */

const NEEDS_0221 = "QuickBooks needs a database update first: run 0221_quickbooks_connection.sql in Supabase.";

export type QuickBooksSettings = {
  /** 0221 has run. */
  ready: boolean;
  /** The CRM's Intuit app is set up, and logins can be kept encrypted. */
  configured: boolean;
  encryption: boolean;
  /** Intuit's practice companies, until the CRM is switched to live books. */
  environment: "sandbox" | "production";
  connection: {
    connected: boolean;
    companyName: string | null;
    environment: "sandbox" | "production";
    connectedAt: string | null;
    connectedByName: string | null;
    accountsReadAt: string | null;
    lastError: string | null;
  } | null;
  choices: { paidFrom: QbAccount[]; expense: QbAccount[] };
  paidFrom: { id: string; name: string; kind: string; last4: string | null; qbAccountId: string | null }[];
  /** The default first (key ''), then each category the company uses. */
  categories: { key: string; category: string; qbAccountId: string | null }[];
};

async function officeAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  return { profile, admin: createAdminClient() };
}

export async function getQuickBooksSettings(): Promise<QuickBooksSettings | null> {
  const who = await officeAdmin();
  if (!who) return null;
  const { profile, admin } = who;
  const companyId = profile.company_id;
  const creds = quickbooksCredentials();

  const [{ ready, connection }, { data: paid }, { data: matchRows }, { data: costRows }, { data: vendorRows }] = await Promise.all([
    readQuickBooksConnection(admin, companyId),
    admin
      .from("payment_accounts")
      .select("id, name, kind, last4, qb_account_id")
      .eq("company_id", companyId)
      .is("archived_at", null)
      .order("name")
      .returns<{ id: string; name: string; kind: string; last4: string | null; qb_account_id: string | null }[]>(),
    admin
      .from("quickbooks_expense_accounts")
      .select("category_key, category, qb_account_id")
      .eq("company_id", companyId)
      .returns<{ category_key: string; category: string; qb_account_id: string }[]>(),
    // The categories in use: the latest costs, and vendors' defaults.
    admin
      .from("job_expenses")
      .select("category")
      .eq("company_id", companyId)
      .not("category", "is", null)
      .order("created_at", { ascending: false })
      .limit(5000)
      .returns<{ category: string | null }[]>(),
    admin
      .from("vendors")
      .select("default_category")
      .eq("company_id", companyId)
      .returns<{ default_category: string | null }[]>(),
  ]);

  let connectedByName: string | null = null;
  if (connection?.connectedBy) {
    const members = await getCompanyMembers(companyId);
    const m = members.find((x) => x.id === connection.connectedBy);
    connectedByName = m?.name || m?.email || null;
  }

  const matched = new Map((matchRows ?? []).map((r) => [r.category_key, r]));
  const used = costCategories([...(costRows ?? []).map((r) => r.category), ...(vendorRows ?? []).map((r) => r.default_category)]);
  const accounts = connection?.accounts ?? [];

  return {
    ready,
    configured: !!creds && encryptionAvailable(),
    encryption: encryptionAvailable(),
    environment: creds?.environment ?? "sandbox",
    connection: connection
      ? {
          connected: connection.connected,
          companyName: connection.companyName,
          environment: connection.environment,
          connectedAt: connection.connectedAt,
          connectedByName,
          accountsReadAt: connection.accountsReadAt,
          lastError: connection.lastError,
        }
      : null,
    choices: { paidFrom: accountChoices(accounts, "paid_from"), expense: accountChoices(accounts, "expense") },
    paidFrom: (paid ?? []).map((a) => ({ id: a.id, name: a.name, kind: a.kind, last4: a.last4, qbAccountId: a.qb_account_id })),
    categories: [
      { key: "", category: "", qbAccountId: matched.get("")?.qb_account_id ?? null },
      ...used.map((c) => ({ key: categoryKey(c), category: c, qbAccountId: matched.get(categoryKey(c))?.qb_account_id ?? null })),
    ],
  };
}

/** Reads QuickBooks' accounts again: one added there since connecting. */
export async function refreshQuickBooksAccounts(): Promise<{ error?: string; count?: number }> {
  const who = await officeAdmin();
  if (!who) return { error: "Only Office or Admin users can change this." };
  const got = await quickBooksAccess(who.admin, who.profile.company_id);
  if ("error" in got) return { error: got.error };
  const read = await readQbAccounts(got.access);
  if ("error" in read) return { error: read.error };
  const { error } = await who.admin
    .from("quickbooks_connections")
    .update({ accounts: read.accounts, accounts_read_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() })
    .eq("company_id", who.profile.company_id);
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0221 : error.message };
  revalidatePath("/settings/quickbooks");
  return { count: read.accounts.length };
}

/**
 * Disconnects: the CRM's access is withdrawn at Intuit and the login
 * forgotten. Nothing in QuickBooks changes. The matches stay, for when
 * the same QuickBooks company is connected again.
 */
export async function disconnectQuickBooks(): Promise<{ error?: string }> {
  const who = await officeAdmin();
  if (!who) return { error: "Only Office or Admin users can change this." };
  const companyId = who.profile.company_id;
  const { data } = await who.admin
    .from("quickbooks_connections")
    .select("refresh_token_enc")
    .eq("company_id", companyId)
    .maybeSingle<{ refresh_token_enc: string | null }>();
  const creds = quickbooksCredentials();
  const refresh = decryptSecret(data?.refresh_token_enc);
  if (creds && refresh) await revokeQuickBooksToken({ fetchImpl: fetch, creds, token: refresh });
  const { error } = await who.admin
    .from("quickbooks_connections")
    .update({
      access_token_enc: null,
      refresh_token_enc: null,
      access_expires_at: null,
      refresh_expires_at: null,
      disconnected_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId);
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0221 : error.message };
  revalidatePath("/settings/quickbooks");
  return {};
}

/**
 * Saves which QuickBooks account is which: each "paid from" account's,
 * and each cost category's (the default under key ''). Only accounts of
 * the right kind in the connected QuickBooks can be picked.
 */
export async function saveQuickBooksMatches(input: {
  paidFrom: { id: string; qbAccountId: string | null }[];
  categories: { category: string; qbAccountId: string | null }[];
}): Promise<{ error?: string }> {
  const who = await officeAdmin();
  if (!who) return { error: "Only Office or Admin users can change this." };
  const companyId = who.profile.company_id;
  const { ready, connection } = await readQuickBooksConnection(who.admin, companyId);
  if (!ready) return { error: NEEDS_0221 };
  if (!connection?.connected) return { error: "Connect QuickBooks first." };
  const paidFromIds = new Set(accountChoices(connection.accounts, "paid_from").map((a) => a.id));
  const expenseIds = new Set(accountChoices(connection.accounts, "expense").map((a) => a.id));
  if (input.paidFrom.some((p) => p.qbAccountId && !paidFromIds.has(p.qbAccountId))) {
    return { error: "Pick a QuickBooks bank or credit card account for each one." };
  }
  if (input.categories.some((c) => c.qbAccountId && !expenseIds.has(c.qbAccountId))) {
    return { error: "Pick a QuickBooks expense or cost account for each category." };
  }

  for (const p of input.paidFrom) {
    const { error } = await who.admin
      .from("payment_accounts")
      .update({ qb_account_id: p.qbAccountId || null })
      .eq("id", p.id)
      .eq("company_id", companyId);
    if (error) return { error: error.message };
  }
  const keep = input.categories
    .filter((c) => c.qbAccountId)
    .map((c) => ({
      company_id: companyId,
      category_key: categoryKey(c.category),
      category: c.category.trim(),
      qb_account_id: c.qbAccountId!,
      updated_at: new Date().toISOString(),
    }));
  const clear = input.categories.filter((c) => !c.qbAccountId).map((c) => categoryKey(c.category));
  if (keep.length) {
    const { error } = await who.admin.from("quickbooks_expense_accounts").upsert(keep, { onConflict: "company_id,category_key" });
    if (error) return { error: isMissingSchemaError(error) ? NEEDS_0221 : error.message };
  }
  if (clear.length) {
    const { error } = await who.admin
      .from("quickbooks_expense_accounts")
      .delete()
      .eq("company_id", companyId)
      .in("category_key", clear);
    if (error) return { error: error.message };
  }
  revalidatePath("/settings/quickbooks");
  revalidatePath("/settings/payment-accounts");
  return {};
}
