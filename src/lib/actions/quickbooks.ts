"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { isAdminRole } from "@/lib/data/types";
import { todayForCompany } from "@/lib/data/company-today";
import { isCompanyLocked, lockedServicesError } from "@/lib/billing/company-lock";
import { encryptionAvailable, decryptSecret } from "@/lib/crypto/secrets";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { quickbooksCredentials, revokeQuickBooksToken } from "@/lib/quickbooks/oauth";
import { quickBooksAccess, readQbAccounts, readQuickBooksConnection } from "@/lib/quickbooks/connection";
import { accountChoices, categoryKey, costCategories, type QbAccount } from "@/lib/quickbooks/accounts";
import { syncCompanyBills } from "@/lib/quickbooks/bill-sync-run";

/**
 * Settings › QuickBooks: the connection and the account matches (step 1,
 * DECISIONS #172), and sending bills and bill payments (step 2, #173).
 * Office or Admin, like the rest of the company's settings.
 */

const NEEDS_0221 = "QuickBooks needs a database update first: run 0221_quickbooks_connection.sql in Supabase.";
const NEEDS_0222 = "Sending bills needs a database update first: run 0222_quickbooks_bills.sql in Supabase.";
const isDay = (s?: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Something that needs a look on the settings page: waiting, or refused by QuickBooks. */
export type QuickBooksAttention = {
  kind: "bill" | "payment";
  vendor: string;
  amountCents: number | null;
  day: string | null;
  /** The payment is no longer in the CRM (its void in QuickBooks is what's stuck). */
  deleted: boolean;
  status: "waiting" | "failed" | "gone";
  reason: string;
};

export type QuickBooksBillSending = {
  /** 0222 has run. */
  ready: boolean;
  on: boolean;
  from: string | null;
  /** The company's today, the start date offered when it's first turned on. */
  today: string;
  checkedAt: string | null;
  counts: { sent: number; waiting: number; failed: number };
  attention: QuickBooksAttention[];
};

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
  bills: QuickBooksBillSending;
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

  const bills = await readBillSending(admin, companyId, connection?.connected ? connection.realmId : null);

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
    bills,
  };
}

type Admin = ReturnType<typeof createAdminClient>;

/** The send-bills switch, its counts, and what's waiting, for the connected QuickBooks company. */
async function readBillSending(admin: Admin, companyId: string, realmId: string | null): Promise<QuickBooksBillSending> {
  const today = await todayForCompany(admin, companyId);
  const off: QuickBooksBillSending = {
    ready: true,
    on: false,
    from: null,
    today,
    checkedAt: null,
    counts: { sent: 0, waiting: 0, failed: 0 },
    attention: [],
  };
  const { data: conn, error } = await admin
    .from("quickbooks_connections")
    .select("send_bills, send_bills_from, bills_checked_at")
    .eq("company_id", companyId)
    .maybeSingle<{ send_bills: boolean; send_bills_from: string | null; bills_checked_at: string | null }>();
  if (error) return { ...off, ready: !isMissingSchemaError(error) };
  const base = { ...off, on: !!conn?.send_bills, from: conn?.send_bills_from ?? null, checkedAt: conn?.bills_checked_at ?? null };
  if (!realmId) return base;

  const count = async (status: string) => {
    const { count: n } = await admin
      .from("quickbooks_sync")
      .select("record_id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("realm_id", realmId)
      .eq("status", status);
    return n ?? 0;
  };
  const [sent, waiting, failed, gone, { data: open }] = await Promise.all([
    count("sent"),
    count("waiting"),
    count("failed"),
    count("gone"),
    admin
      .from("quickbooks_sync")
      .select("record_type, record_id, bill_id, status, reason")
      .eq("company_id", companyId)
      .eq("realm_id", realmId)
      .in("status", ["waiting", "failed", "gone"])
      .order("updated_at", { ascending: false })
      .limit(20)
      .returns<{ record_type: "bill" | "bill_payment"; record_id: string; bill_id: string | null; status: "waiting" | "failed" | "gone"; reason: string | null }[]>(),
  ]);

  // Name each one the way Bills to Pay does: the vendor, the amount, the day.
  const rows = open ?? [];
  const paymentIds = rows.filter((r) => r.record_type === "bill_payment").map((r) => r.record_id);
  const billIds = [...new Set(rows.map((r) => (r.record_type === "bill" ? r.record_id : r.bill_id ?? "")).filter(Boolean))];
  const [{ data: payRows }, { data: billRows }] = await Promise.all([
    paymentIds.length
      ? admin.from("vendor_bill_payments").select("id, amount_cents, paid_on").eq("company_id", companyId).in("id", paymentIds)
      : Promise.resolve({ data: [] }),
    billIds.length
      ? admin.from("vendor_bills").select("id, vendor_id, vendor_name, amount_cents, bill_date").eq("company_id", companyId).in("id", billIds)
      : Promise.resolve({ data: [] }),
  ]);
  const billsById = new Map(
    ((billRows ?? []) as { id: string; vendor_id: string | null; vendor_name: string | null; amount_cents: number; bill_date: string | null }[]).map(
      (b) => [b.id, b]
    )
  );
  const vendorIds = [...new Set([...billsById.values()].map((b) => b.vendor_id).filter((v): v is string => !!v))];
  const { data: vendorRows } = vendorIds.length
    ? await admin.from("vendors").select("id, name").eq("company_id", companyId).in("id", vendorIds)
    : { data: [] };
  const vendorName = new Map(((vendorRows ?? []) as { id: string; name: string }[]).map((v) => [v.id, v.name]));
  const payById = new Map(((payRows ?? []) as { id: string; amount_cents: number; paid_on: string }[]).map((x) => [x.id, x]));

  const attention: QuickBooksAttention[] = rows.map((r) => {
    const bill = billsById.get(r.record_type === "bill" ? r.record_id : r.bill_id ?? "");
    const isPayment = r.record_type === "bill_payment";
    const pay = isPayment ? payById.get(r.record_id) : undefined;
    return {
      kind: isPayment ? "payment" : "bill",
      vendor: (bill?.vendor_id ? vendorName.get(bill.vendor_id) : null) ?? bill?.vendor_name ?? "A bill",
      // A payment deleted in the CRM: not the bill's amount or date.
      amountCents: isPayment ? (pay ? Number(pay.amount_cents) : null) : bill ? Number(bill.amount_cents) : null,
      day: isPayment ? pay?.paid_on ?? null : bill?.bill_date ?? null,
      deleted: isPayment && !pay,
      status: r.status,
      reason: r.reason ?? "",
    };
  });
  // Deleted in QuickBooks by someone there counts with what didn't go.
  return { ...base, counts: { sent, waiting, failed: failed + gone }, attention };
}

/**
 * Turns sending bills to QuickBooks on or off, and sets the start date:
 * only bills dated from it go, so the ones the bookkeeper already typed
 * into QuickBooks aren't doubled.
 */
export async function saveQuickBooksBillSending(input: { on: boolean; from: string | null }): Promise<{ error?: string }> {
  const who = await officeAdmin();
  if (!who) return { error: "Only Office or Admin users can change this." };
  const companyId = who.profile.company_id;
  if (input.on) {
    if (await isCompanyLocked(companyId)) return { error: (await lockedServicesError(companyId)) ?? "This company is locked." };
    if (!isDay(input.from)) return { error: "Pick the date bills start from." };
    const { connection } = await readQuickBooksConnection(who.admin, companyId);
    if (!connection?.connected) return { error: "Connect QuickBooks first." };
  }
  const { data, error } = await who.admin
    .from("quickbooks_connections")
    .update({ send_bills: !!input.on, send_bills_from: input.on ? input.from : undefined, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .select("company_id");
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0222 : error.message };
  if (!data?.length) return { error: "Connect QuickBooks first." };
  revalidatePath("/settings/quickbooks");
  revalidatePath("/bills");
  return {};
}

export type SendNowResult = {
  error?: string;
  sent?: number;
  changed?: number;
  removed?: number;
  waiting?: number;
  failed?: number;
  more?: boolean;
};

/**
 * Send now: this company's new and changed bills go at once, refusals
 * tried again. Stops starting work after 20 seconds (and cuts off a call
 * still going at 45), inside the page's 60-second limit; the rest goes
 * with the five-minute job.
 */
export async function sendBillsToQuickBooksNow(): Promise<SendNowResult> {
  const who = await officeAdmin();
  if (!who) return { error: "Only Office or Admin users can change this." };
  const companyId = who.profile.company_id;
  if (await isCompanyLocked(companyId)) return { error: (await lockedServicesError(companyId)) ?? "This company is locked." };
  let s;
  try {
    s = await syncCompanyBills(who.admin, companyId, { writeCap: 40, budgetMs: 20_000, force: true });
  } catch {
    return { error: "Sending didn't finish. Try again in a minute; nothing is sent twice." };
  } finally {
    revalidatePath("/settings/quickbooks");
    revalidatePath("/bills");
  }
  if (s.busy) return { error: "QuickBooks is already sending this company's bills. Look again in a minute." };
  const result = { sent: s.sent, changed: s.changed, removed: s.removed, waiting: s.waiting, failed: s.failed, more: s.more };
  return s.error ? { ...result, error: s.error } : result;
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
