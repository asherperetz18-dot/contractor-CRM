"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { isAdminRole } from "@/lib/data/types";
import { todayForCompany, zoneForCompany } from "@/lib/data/company-today";
import { isoDateInZone } from "@/lib/company-clock";
import { isCompanyLocked, lockedServicesError } from "@/lib/billing/company-lock";
import { encryptionAvailable, decryptSecret } from "@/lib/crypto/secrets";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { quickbooksCredentials, revokeQuickBooksToken } from "@/lib/quickbooks/oauth";
import { quickBooksAccess, readQbAccounts, readQuickBooksConnection } from "@/lib/quickbooks/connection";
import { quickBooksReceiptsReady } from "@/lib/quickbooks/receipts-ready";
import { accountChoices, categoryKey, costCategories, type QbAccount } from "@/lib/quickbooks/accounts";
import { syncCompanyBills } from "@/lib/quickbooks/bill-sync-run";
import { FOR_BILLS, syncCompanyInvoices } from "@/lib/quickbooks/invoice-sync-run";
import { syncCompanyCosts } from "@/lib/quickbooks/cost-sync-run";
import { costTrouble, type CostTroubleRow } from "@/lib/quickbooks/cost-status";
import { qbDocNumber, SALES_WAIT } from "@/lib/quickbooks/invoice-sync";
import { fetchUntil, readItems, type QbItem, type QbPrefs } from "@/lib/quickbooks/api";
import { clientName } from "@/lib/data/client-name";

/**
 * Settings › QuickBooks: the connection and the account matches (step 1,
 * DECISIONS #172), sending bills and bill payments (step 2, #173),
 * sending invoices and customer payments (step 3, #184), and sending
 * lender fees as expenses (step 4, #199). Office or Admin, like the rest
 * of the company's settings.
 */

/** Step 2's record types: its counts and Needs a look leave step 3's out. */
const BILL_TYPES = ["bill", "bill_payment", "receipt"];
/** Step 3's, as Settings counts them (customers, jobs and the $0.00 credit links aren't counted). */
const INVOICE_TYPES = ["invoice", "deposit", "customer_payment", "credit", "refund"];
// A credit's $0.00 payment (applying it to its invoice) isn't counted as sent on its own, but its trouble is the credit's;
// so is a customer's or job's that couldn't be added (or was made inactive) for its bills' job.
const INVOICE_TROUBLE_TYPES = [...INVOICE_TYPES, "credit_link", "customer", "job"];
const NEEDS_0225 = "Sending invoices needs a database update first: run 0227_quickbooks_invoices.sql in Supabase.";
/** Step 4's record types (DECISIONS #199): the expense counts as sent; its receipt's trouble counts too. */
const COST_TYPES = ["expense", "expense_receipt"];
const NEEDS_0230 = "Sending job costs needs a database update first: run 0230_quickbooks_job_costs.sql in Supabase.";

const NEEDS_0221 = "QuickBooks needs a database update first: run 0221_quickbooks_connection.sql in Supabase.";
const NEEDS_0222 = "Sending bills needs a database update first: run 0222_quickbooks_bills.sql in Supabase.";
const isDay = (s?: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Something that needs a look on the settings page: waiting, or refused by QuickBooks. */
export type QuickBooksAttention = {
  kind: "bill" | "payment" | "receipt";
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
  /** 0223 has run (null: couldn't tell): receipts go with their bills (DECISIONS #174). */
  receiptsReady: boolean | null;
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
  invoices: QuickBooksInvoiceSending;
  costs: QuickBooksCostSending;
};

/** Something on the invoices side that needs a look: waiting, or refused by QuickBooks. */
export type QuickBooksInvoiceAttention = {
  customer: string;
  amountCents: number | null;
  /** "invoice INV-1006", "payment", "credit", "refund", "deposit invoice EST-1047-D". */
  what: string;
  day: string | null;
  status: "waiting" | "failed" | "gone";
  reason: string;
};

export type QuickBooksInvoiceSending = {
  /** 0227 has run. */
  ready: boolean;
  on: boolean;
  from: string | null;
  today: string;
  checkedAt: string | null;
  items: QbItem[];
  itemsReadAt: string | null;
  jobItem: string | null;
  depositItem: string | null;
  costItem: string | null;
  paymentsAccount: string | null;
  stripeRefundsAccount: string | null;
  handRefundsAccount: string | null;
  sendOutside: boolean;
  /** Accounts payments can go to (Bank, Other Current Asset); refunds by hand come from a Bank account. */
  choices: { deposit: QbAccount[]; bank: QbAccount[] };
  prefs: QbPrefs | null;
  counts: { sent: number; waiting: number; failed: number };
  attention: QuickBooksInvoiceAttention[];
};

/** A job cost that needs a look (DECISIONS #199): waiting, or refused by QuickBooks. */
export type QuickBooksCostAttention = {
  kind: "expense" | "receipt";
  /** The vendor's name, or the typed vendor; "A cost" when there's neither. */
  vendor: string;
  /** The cost's customer (else the one its record was on when last seen). */
  customer: string | null;
  amountCents: number | null;
  /** spent_on. */
  day: string | null;
  /** The cost is no longer in the CRM. */
  deleted: boolean;
  status: "waiting" | "failed" | "gone";
  reason: string;
};

export type QuickBooksCostSending = {
  /** 0230 has run. */
  ready: boolean;
  on: boolean;
  from: string | null;
  today: string;
  checkedAt: string | null;
  lenderPayoutsAccount: string | null;
  /** Bank accounts only (decision 3). */
  choices: { bank: QbAccount[] };
  /** "Financing fee" is matched under Where job costs go (fees wait until it is). */
  feeMatched: boolean;
  counts: { sent: number; waiting: number; failed: number };
  attention: QuickBooksCostAttention[];
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

  const [bills, invoices, costs] = await Promise.all([
    readBillSending(admin, companyId, connection?.connected ? connection.realmId : null),
    readInvoiceSending(admin, companyId, connection?.connected ? connection.realmId : null, connection?.accounts ?? []),
    readCostSending(admin, companyId, connection?.connected ? connection.realmId : null, connection?.accounts ?? []),
  ]);

  const matched = new Map((matchRows ?? []).map((r) => [r.category_key, r]));
  const used = costCategories([
    ...(costRows ?? []).map((r) => r.category),
    ...(vendorRows ?? []).map((r) => r.default_category),
    // Lender fees wait until "Financing fee" is matched (#199): it's listed once 0230 has run, so it can be matched first.
    ...(costs.ready ? ["Financing fee"] : []),
  ]);
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
    invoices,
    costs: { ...costs, feeMatched: matched.has(categoryKey("Financing fee")) },
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
    receiptsReady: true,
  };
  const [{ data: conn, error }, receiptsReady] = await Promise.all([
    admin
      .from("quickbooks_connections")
      .select("send_bills, send_bills_from, bills_checked_at")
      .eq("company_id", companyId)
      .maybeSingle<{ send_bills: boolean; send_bills_from: string | null; bills_checked_at: string | null }>(),
    quickBooksReceiptsReady(admin),
  ]);
  if (error) return { ...off, ready: !isMissingSchemaError(error) };
  const base = {
    ...off,
    on: !!conn?.send_bills,
    from: conn?.send_bills_from ?? null,
    checkedAt: conn?.bills_checked_at ?? null,
    receiptsReady,
  };
  if (!realmId) return base;

  const count = async (status: string) => {
    const { count: n } = await admin
      .from("quickbooks_sync")
      .select("record_id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("realm_id", realmId)
      .in("record_type", BILL_TYPES)
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
      .in("record_type", BILL_TYPES)
      .in("status", ["waiting", "failed", "gone"])
      .order("updated_at", { ascending: false })
      .limit(20)
      .returns<{ record_type: "bill" | "bill_payment" | "receipt"; record_id: string; bill_id: string | null; status: "waiting" | "failed" | "gone"; reason: string | null }[]>(),
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
      // A receipt is named by its bill: the vendor, the amount, the day.
      kind: isPayment ? "payment" : r.record_type === "receipt" ? "receipt" : "bill",
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

/**
 * Send now, for job costs (DECISIONS #199): this company's new and changed
 * lender fees go at once, refusals tried again (notes to enter one by hand
 * stand). Stops starting work after 20 seconds (and cuts off a call still
 * going at 45), inside the page's 60-second limit; the rest goes with the
 * five-minute job. Invoices aren't sent first: a brand-new fee goes without
 * its job either way, and moves onto it with the five-minute job once the
 * invoices job has added it.
 */
export async function sendCostsToQuickBooksNow(): Promise<SendNowResult> {
  const who = await officeAdmin();
  if (!who) return { error: "Only Office or Admin users can change this." };
  const companyId = who.profile.company_id;
  if (await isCompanyLocked(companyId)) return { error: (await lockedServicesError(companyId)) ?? "This company is locked." };
  let s;
  try {
    s = await syncCompanyCosts(who.admin, companyId, { writeCap: 40, budgetMs: 20_000, force: true });
  } catch {
    return { error: "Sending didn't finish. Try again in a minute; nothing is sent twice." };
  } finally {
    revalidatePath("/settings/quickbooks");
    revalidatePath("/bills");
  }
  if (s.busy) return { error: "QuickBooks is already sending this company's job costs. Look again in a minute." };
  const result = { sent: s.sent, changed: s.changed, removed: s.removed, waiting: s.waiting, failed: s.failed, more: s.more };
  return s.error ? { ...result, error: s.error } : result;
}

/** Reads QuickBooks' accounts again, and its products and services for invoices, saying how many of each came back. */
export async function refreshQuickBooksAccounts(): Promise<{ error?: string; count?: number; items?: number; itemsError?: string }> {
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
  // Products and services too, for invoices (DECISIONS #184); before 0227 there's nowhere to keep them.
  const items = await readItems(got.access);
  if ("error" in items) {
    revalidatePath("/settings/quickbooks");
    return { count: read.accounts.length, itemsError: `Products and services couldn't be read from QuickBooks: ${items.error.message}` };
  }
  const { error: itemsSaveError } = await who.admin
    .from("quickbooks_connections")
    .update({ items: items.items, items_read_at: new Date().toISOString() })
    .eq("company_id", who.profile.company_id);
  revalidatePath("/settings/quickbooks");
  if (itemsSaveError) {
    return { count: read.accounts.length, itemsError: isMissingSchemaError(itemsSaveError) ? NEEDS_0225 : itemsSaveError.message };
  }
  return { count: read.accounts.length, items: items.items.length };
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

// ---------------------------------------------------------------- step 3: invoices and customer payments (DECISIONS #184)

const ACCOUNT_DEPOSIT_TYPES = ["Bank", "Other Current Asset"];

/** The send-invoices switch, its matches, QuickBooks' own settings, counts and what's waiting. */
async function readInvoiceSending(admin: Admin, companyId: string, realmId: string | null, accounts: QbAccount[]): Promise<QuickBooksInvoiceSending> {
  const today = await todayForCompany(admin, companyId);
  const sorted = (types: string[]) => accounts.filter((a) => types.includes(a.type)).sort((a, b) => a.name.localeCompare(b.name));
  const off: QuickBooksInvoiceSending = {
    ready: true,
    on: false,
    from: null,
    today,
    checkedAt: null,
    items: [],
    itemsReadAt: null,
    jobItem: null,
    depositItem: null,
    costItem: null,
    paymentsAccount: null,
    stripeRefundsAccount: null,
    handRefundsAccount: null,
    sendOutside: false,
    choices: { deposit: sorted(ACCOUNT_DEPOSIT_TYPES), bank: sorted(["Bank"]) },
    prefs: null,
    counts: { sent: 0, waiting: 0, failed: 0 },
    attention: [],
  };
  const { data: conn, error } = await admin
    .from("quickbooks_connections")
    .select(
      "send_invoices, send_invoices_from, invoices_checked_at, items, items_read_at, invoice_item_id, deposit_item_id, cost_item_id, " +
        "payments_account_id, stripe_refunds_account_id, hand_refunds_account_id, send_outside_crm, qb_prefs"
    )
    .eq("company_id", companyId)
    .maybeSingle<{
      send_invoices: boolean;
      send_invoices_from: string | null;
      invoices_checked_at: string | null;
      items: QbItem[] | null;
      items_read_at: string | null;
      invoice_item_id: string | null;
      deposit_item_id: string | null;
      cost_item_id: string | null;
      payments_account_id: string | null;
      stripe_refunds_account_id: string | null;
      hand_refunds_account_id: string | null;
      send_outside_crm: boolean;
      qb_prefs: QbPrefs | null;
    }>();
  if (error) return { ...off, ready: !isMissingSchemaError(error) };
  const base: QuickBooksInvoiceSending = {
    ...off,
    on: !!conn?.send_invoices,
    from: conn?.send_invoices_from ?? null,
    checkedAt: conn?.invoices_checked_at ?? null,
    items: Array.isArray(conn?.items) ? conn!.items! : [],
    itemsReadAt: conn?.items_read_at ?? null,
    jobItem: conn?.invoice_item_id ?? null,
    depositItem: conn?.deposit_item_id ?? null,
    costItem: conn?.cost_item_id ?? null,
    paymentsAccount: conn?.payments_account_id ?? null,
    stripeRefundsAccount: conn?.stripe_refunds_account_id ?? null,
    handRefundsAccount: conn?.hand_refunds_account_id ?? null,
    sendOutside: !!conn?.send_outside_crm,
    prefs: conn?.qb_prefs ?? null,
  };
  if (!realmId) return base;

  const count = async (status: string) => {
    const { count: n } = await admin
      .from("quickbooks_sync")
      .select("record_id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("realm_id", realmId)
      .in("record_type", status === "sent" ? INVOICE_TYPES : INVOICE_TROUBLE_TYPES)
      .eq("status", status);
    return n ?? 0;
  };
  type OpenRow = {
    record_type: string;
    record_id: string;
    bill_id: string | null;
    status: "waiting" | "failed" | "gone";
    failed_op: string | null;
    reason: string | null;
    tried_hash: string | null;
  };
  const [sent, waiting, failed, gone, { data: recent }, { data: undoRows }] = await Promise.all([
    count("sent"),
    count("waiting"),
    count("failed"),
    count("gone"),
    admin
      .from("quickbooks_sync")
      .select("record_type, record_id, bill_id, status, failed_op, reason, tried_hash")
      .eq("company_id", companyId)
      .eq("realm_id", realmId)
      .in("record_type", INVOICE_TROUBLE_TYPES)
      .in("status", ["waiting", "failed", "gone"])
      .order("updated_at", { ascending: false })
      .limit(100)
      .returns<OpenRow[]>(),
    // "Take it out of QuickBooks" notes: shown nowhere else, so every one is listed, however old.
    admin
      .from("quickbooks_sync")
      .select("record_type, record_id, bill_id, status, failed_op, reason, tried_hash")
      .eq("company_id", companyId)
      .eq("realm_id", realmId)
      .in("record_type", INVOICE_TROUBLE_TYPES)
      .eq("status", "waiting")
      .in("reason", [SALES_WAIT.undoTakenBack, SALES_WAIT.undoFailed])
      .order("updated_at", { ascending: false })
      .limit(200)
      .returns<OpenRow[]>(),
  ]);

  // Name each one: the customer, the amount, what it is, the day.
  const undo = undoRows ?? [];
  const undoKeys = new Set(undo.map((r) => `${r.record_type}:${r.record_id}`));
  const rows = [...undo, ...(recent ?? []).filter((r) => !undoKeys.has(`${r.record_type}:${r.record_id}`))];
  const idsOf = (...types: string[]) => rows.filter((r) => types.includes(r.record_type)).map((r) => r.record_id);
  // The bill each payment, refund or credit is on: it still names one deleted in the CRM since.
  const billIds = rows.filter((r) => ["customer_payment", "refund", "credit", "credit_link"].includes(r.record_type) && r.bill_id).map((r) => r.bill_id!);
  const stageIds = [...new Set([...idsOf("invoice"), ...billIds])];
  const [{ data: stageRows }, { data: moneyRows }, { data: creditRows }] = await Promise.all([
    stageIds.length
      ? admin.from("estimate_payments").select("id, estimate_id, name, sort_order, amount_cents, requested_at").eq("company_id", companyId).in("id", stageIds)
      : Promise.resolve({ data: [] }),
    idsOf("customer_payment", "refund").length
      ? admin.from("portal_payments").select("id, estimate_id, amount_cents, paid_at, created_at").eq("company_id", companyId).in("id", idsOf("customer_payment", "refund"))
      : Promise.resolve({ data: [] }),
    idsOf("credit", "credit_link").length
      ? admin.from("bill_credits").select("id, estimate_id, amount_cents, created_at").eq("company_id", companyId).in("id", idsOf("credit", "credit_link"))
      : Promise.resolve({ data: [] }),
  ]);
  type Stage = { id: string; estimate_id: string; name: string | null; sort_order: number; amount_cents: number; requested_at: string | null };
  type Money = { id: string; estimate_id: string; amount_cents: number; paid_at: string | null; created_at: string };
  type Credit = { id: string; estimate_id: string; amount_cents: number; created_at: string };
  const stages = new Map(((stageRows ?? []) as Stage[]).map((x) => [x.id, x]));
  const money = new Map(((moneyRows ?? []) as Money[]).map((x) => [x.id, x]));
  const credits = new Map(((creditRows ?? []) as Credit[]).map((x) => [x.id, x]));
  const docIds = [
    ...new Set([
      ...[...stages.values()].map((x) => x.estimate_id),
      ...[...money.values()].map((x) => x.estimate_id),
      ...[...credits.values()].map((x) => x.estimate_id),
      ...idsOf("deposit", "job"),
      ...billIds,
    ]),
  ];
  const { data: docRows } = docIds.length
    ? await admin
        .from("estimates")
        .select("id, lead_id, kind, doc_number, version, supersedes_id, title, deposit_cents, signed_at")
        .eq("company_id", companyId)
        .in("id", docIds)
    : { data: [] };
  type Doc = {
    id: string;
    lead_id: string;
    kind: string | null;
    doc_number: string;
    version: number | null;
    supersedes_id: string | null;
    title: string | null;
    deposit_cents: number | null;
    signed_at: string | null;
  };
  const docs = new Map(((docRows ?? []) as Doc[]).map((d) => [d.id, d]));
  const leadIds = [...new Set([...[...docs.values()].map((d) => d.lead_id), ...idsOf("customer")])];
  const { data: leadRows } = leadIds.length
    ? await admin.from("leads").select("id, contact_type, company_name, first_name, last_name").eq("company_id", companyId).in("id", leadIds)
    : { data: [] };
  const leadName = new Map(
    ((leadRows ?? []) as { id: string; contact_type: string | null; company_name: string | null; first_name: string | null; last_name: string | null }[]).map((l) => [
      l.id,
      clientName(l) || "A customer",
    ])
  );
  const who = (docId: string | undefined) => (docId ? leadName.get(docs.get(docId)?.lead_id ?? "") : undefined) ?? "A customer";
  /** The contract (or invoice) a record's bill is on: a stage's, or the contract itself for its deposit. */
  const billDoc = (billId: string | null) => (billId ? (stages.get(billId)?.estimate_id ?? (docs.has(billId) ? billId : undefined)) : undefined);
  // Days on the company's calendar, as QuickBooks and the Invoices page have them.
  const zone = await zoneForCompany(admin, companyId);
  const localDay = (iso: string | null | undefined) => (iso ? isoDateInZone(new Date(iso), zone) : null);

  // A stage paid before it was billed, or taken back off its bill, has no row on the Invoices page: it's listed first.
  const noRow = (r: (typeof rows)[number]) => {
    if (r.record_type !== "invoice") return false;
    const st = stages.get(r.record_id);
    return !st || !st.requested_at;
  };
  const rest = rows.filter((r) => !undoKeys.has(`${r.record_type}:${r.record_id}`));
  // Every take-it-out note, then up to 20 others (stages with no row first): the notes never crowd those out.
  const listed = [...undo, ...[...rest.filter(noRow), ...rest.filter((r) => !noRow(r))].slice(0, 20)];
  const attention: QuickBooksInvoiceAttention[] = listed.map((r) => {
    const base = { status: r.status, reason: r.reason ?? "" };
    // "For its bills": wanted only to tag Bills to Pay costs with (else an invoice needed it).
    const forBills = r.tried_hash === FOR_BILLS;
    if (r.record_type === "customer") {
      return { ...base, customer: leadName.get(r.record_id) ?? "A customer", amountCents: null, what: forBills ? "customer, for its bills' job" : "customer", day: null };
    }
    if (r.record_type === "job") {
      const d = docs.get(r.record_id);
      const name = `job${d ? ` ${qbDocNumber(d)}${d.title ? ` ${d.title}` : ""}` : ""}`;
      return { ...base, customer: who(r.record_id), amountCents: null, what: forBills ? `${name}, for its bills` : name, day: null };
    }
    if (r.record_type === "invoice") {
      const st = stages.get(r.record_id);
      const d = st ? docs.get(st.estimate_id) : undefined;
      // Named as it goes to QuickBooks (a revision's number carries its version).
      const label = d ? (d.kind === "invoice" ? d.doc_number : `${qbDocNumber(d)} ${st?.name || `stage ${(st?.sort_order ?? 0) + 1}`}`) : "";
      return { ...base, customer: who(st?.estimate_id), amountCents: st ? Number(st.amount_cents) : null, what: `invoice${label ? ` ${label}` : ""}`, day: localDay(st?.requested_at) };
    }
    if (r.record_type === "deposit") {
      const d = docs.get(r.record_id);
      return { ...base, customer: who(r.record_id), amountCents: d?.deposit_cents ?? null, what: `deposit invoice${d ? ` ${qbDocNumber(d)}-D` : ""}`, day: localDay(d?.signed_at) };
    }
    if (r.record_type === "credit" || r.record_type === "credit_link") {
      const c = credits.get(r.record_id);
      const what = `${r.record_type === "credit" ? "credit" : "credit (applying it to its invoice)"}${c ? "" : " (deleted in the CRM)"}`;
      return { ...base, customer: who(c?.estimate_id ?? billDoc(r.bill_id)), amountCents: c ? Number(c.amount_cents) : null, what, day: localDay(c?.created_at) };
    }
    const m = money.get(r.record_id);
    return {
      ...base,
      customer: who(m?.estimate_id ?? billDoc(r.bill_id)),
      amountCents: m ? Math.abs(Number(m.amount_cents)) : null,
      what: `${r.record_type === "refund" ? "refund" : "payment"}${m ? "" : " (deleted in the CRM)"}`,
      day: localDay(m?.paid_at ?? m?.created_at),
    };
  }).map((a, i) => (listed[i].failed_op === "change" ? { ...a, what: `${a.what} (its last change)` } : a));
  return { ...base, counts: { sent, waiting, failed: failed + gone }, attention };
}

export type InvoiceSendingInput = {
  on: boolean;
  from: string | null;
  jobItem: string | null;
  depositItem: string | null;
  costItem: string | null;
  paymentsAccount: string | null;
  stripeRefundsAccount: string | null;
  handRefundsAccount: string | null;
  sendOutside: boolean;
};

/**
 * Turns sending invoices and customer payments to QuickBooks on or off,
 * with its start date and where they go: only bills dated from it go, so
 * the ones the bookkeeper already typed into QuickBooks aren't doubled.
 */
export async function saveQuickBooksInvoiceSending(input: InvoiceSendingInput): Promise<{ error?: string }> {
  const who = await officeAdmin();
  if (!who) return { error: "Only Office or Admin users can change this." };
  const companyId = who.profile.company_id;
  const { connection } = await readQuickBooksConnection(who.admin, companyId);
  if (!connection?.connected) return { error: "Connect QuickBooks first." };
  const current = await readInvoiceSending(who.admin, companyId, connection.realmId, connection.accounts ?? []);
  if (!current.ready) return { error: NEEDS_0225 };
  const itemIds = new Set(current.items.map((i) => i.id));
  const depositIds = new Set(current.choices.deposit.map((a) => a.id));
  const bankIds = new Set(current.choices.bank.map((a) => a.id));
  const pick = (id: string | null, ok: Set<string>) => (id && ok.has(id) ? id : null);
  if (input.on) {
    if (await isCompanyLocked(companyId)) return { error: (await lockedServicesError(companyId)) ?? "This company is locked." };
    if (!isDay(input.from)) return { error: "Pick the date invoices start from." };
    if (!pick(input.jobItem, itemIds)) return { error: "Pick the QuickBooks product or service for job work." };
  }
  const { data, error } = await who.admin
    .from("quickbooks_connections")
    .update({
      send_invoices: !!input.on,
      send_invoices_from: input.on ? input.from : undefined,
      invoice_item_id: pick(input.jobItem, itemIds),
      deposit_item_id: pick(input.depositItem, itemIds),
      cost_item_id: pick(input.costItem, itemIds),
      payments_account_id: pick(input.paymentsAccount, depositIds),
      stripe_refunds_account_id: pick(input.stripeRefundsAccount, depositIds),
      hand_refunds_account_id: pick(input.handRefundsAccount, bankIds),
      send_outside_crm: !!input.sendOutside,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .select("company_id");
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0225 : error.message };
  if (!data?.length) return { error: "Connect QuickBooks first." };
  revalidatePath("/settings/quickbooks");
  revalidatePath("/invoices");
  return {};
}

/**
 * Send now, for invoices: this company's new and changed invoices,
 * payments, credits and refunds go at once, refusals tried again; then its
 * bills, so a new job tags them. Inside the page's 60-second limit; the
 * rest goes with the five-minute job.
 */
export async function sendInvoicesToQuickBooksNow(): Promise<SendNowResult> {
  const who = await officeAdmin();
  if (!who) return { error: "Only Office or Admin users can change this." };
  const companyId = who.profile.company_id;
  if (await isCompanyLocked(companyId)) return { error: (await lockedServicesError(companyId)) ?? "This company is locked." };
  let s;
  // Both runs inside the page's 60-second limit: every QuickBooks call stops by 45 seconds,
  // and bills go only if there's room left (else with the five-minute job).
  const started = Date.now();
  const fetchImpl = fetchUntil(started + 45_000);
  try {
    s = await syncCompanyInvoices(who.admin, companyId, { writeCap: 40, budgetMs: 15_000, force: true, fetchImpl });
    const { data: conn } = await who.admin.from("quickbooks_connections").select("send_bills").eq("company_id", companyId).maybeSingle<{ send_bills: boolean }>();
    const left = 45_000 - (Date.now() - started);
    if (conn?.send_bills && !s.busy && left >= 15_000) {
      await syncCompanyBills(who.admin, companyId, { writeCap: 20, budgetMs: Math.min(8_000, left - 10_000), fetchImpl });
    }
  } catch {
    return { error: "Sending didn't finish. Try again in a minute; nothing is sent twice." };
  } finally {
    revalidatePath("/settings/quickbooks");
    revalidatePath("/invoices");
    revalidatePath("/bills");
  }
  if (s.busy) return { error: "QuickBooks is already sending this company's invoices. Look again in a minute." };
  const result = { sent: s.sent, changed: s.changed, removed: s.removed, waiting: s.waiting, failed: s.failed, more: s.more };
  return s.error ? { ...result, error: s.error } : result;
}

// ---------------------------------------------------------------- step 4: lender fees as expenses (DECISIONS #199)

/** Reads by id, 100 at a time; null when any read fails (so the caller says nothing rather than something untrue). */
async function readByIds<T>(ids: string[], read: (chunk: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[] | null> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await read(ids.slice(i, i + 100));
    if (error) return null;
    out.push(...((data as T[] | null) ?? []));
  }
  return out;
}

type LeadNameRow = { id: string; first_name: string | null; last_name: string | null; company_name: string | null; contact_type: string | null };

/** The send-job-costs switch, its start date, where lender payouts land, counts and what's waiting. */
async function readCostSending(admin: Admin, companyId: string, realmId: string | null, accounts: QbAccount[]): Promise<QuickBooksCostSending> {
  const today = await todayForCompany(admin, companyId);
  const off: QuickBooksCostSending = {
    ready: true,
    on: false,
    from: null,
    today,
    checkedAt: null,
    lenderPayoutsAccount: null,
    choices: { bank: accounts.filter((a) => a.type === "Bank").sort((a, b) => a.name.localeCompare(b.name)) },
    feeMatched: false,
    counts: { sent: 0, waiting: 0, failed: 0 },
    attention: [],
  };
  const { data: conn, error } = await admin
    .from("quickbooks_connections")
    .select("send_costs, send_costs_from, costs_checked_at, lender_payouts_account_id")
    .eq("company_id", companyId)
    .maybeSingle<{ send_costs: boolean; send_costs_from: string | null; costs_checked_at: string | null; lender_payouts_account_id: string | null }>();
  if (error) return { ...off, ready: !isMissingSchemaError(error) };
  const base: QuickBooksCostSending = {
    ...off,
    on: !!conn?.send_costs,
    from: conn?.send_costs_from ?? null,
    checkedAt: conn?.costs_checked_at ?? null,
    lenderPayoutsAccount: conn?.lender_payouts_account_id ?? null,
  };
  if (!realmId) return base;

  // In QuickBooks: every expense sent. A deleted customer's are still there, so they count.
  const sentRead = admin
    .from("quickbooks_sync")
    .select("record_id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("realm_id", realmId)
    .eq("record_type", "expense")
    .eq("status", "sent");
  // Every waiting, refused or gone record (there are few). A page that fails stops there, and what came back is used.
  const troubleRead = async () => {
    const rows: CostTroubleRow[] = [];
    for (let at = 0; at < 5000; at += 1000) {
      const { data, error: pageError } = await admin
        .from("quickbooks_sync")
        .select("record_type, record_id, lead_id, status, reason, updated_at")
        .eq("company_id", companyId)
        .eq("realm_id", realmId)
        .in("record_type", COST_TYPES)
        .in("status", ["waiting", "failed", "gone"])
        .order("updated_at", { ascending: false })
        .order("record_type")
        .order("record_id")
        .range(at, at + 999)
        .returns<CostTroubleRow[]>();
      if (pageError) break;
      rows.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    return rows;
  };
  const [{ count: sentCount }, rows] = await Promise.all([sentRead, troubleRead()]);
  const sent = sentCount ?? 0;

  // A deleted customer's records are left as they are in QuickBooks: not counted or listed (costTrouble). Deleted means
  // not read back, or in the trash (being deleted or restored). If either read fails, nothing is left out.
  const leadIds = [...new Set(rows.map((r) => r.lead_id).filter((id): id is string => !!id))];
  const [leads, trash] = await Promise.all([
    readByIds<LeadNameRow>(leadIds, (chunk) =>
      admin.from("leads").select("id, first_name, last_name, company_name, contact_type").eq("company_id", companyId).in("id", chunk)
    ),
    readByIds<{ lead_id: string }>(leadIds, (chunk) => admin.from("lead_trash").select("lead_id").eq("company_id", companyId).in("lead_id", chunk)),
  ]);
  const leadById = new Map((leads ?? []).map((l) => [l.id, l]));
  const goneLeads = leads && trash ? new Set([...leadIds.filter((id) => !leadById.has(id)), ...trash.map((t) => t.lead_id)]) : null;
  const { waiting, failed, attention: open } = costTrouble(rows, goneLeads);

  // Name each one the way Bills to Pay does: the vendor, the amount, the day, and the customer.
  type CostRow = { id: string; vendor: string | null; vendor_id: string | null; amount_cents: number; spent_on: string; lead_id: string };
  const costs = await readByIds<CostRow>([...new Set(open.map((r) => r.record_id))], (chunk) =>
    admin.from("job_expenses").select("id, vendor, vendor_id, amount_cents, spent_on, lead_id").eq("company_id", companyId).in("id", chunk)
  );
  const costById = new Map((costs ?? []).map((c) => [c.id, c]));
  const vendorIds = [...new Set((costs ?? []).map((c) => c.vendor_id).filter((v): v is string => !!v))];
  const vendors = await readByIds<{ id: string; name: string }>(vendorIds, (chunk) =>
    admin.from("vendors").select("id, name").eq("company_id", companyId).in("id", chunk)
  );
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]));
  const customer = (id: string | null | undefined) => (id && leadById.has(id) ? clientName(leadById.get(id)) || null : null);

  const attention: QuickBooksCostAttention[] = open.map((r) => {
    const cost = costById.get(r.record_id);
    return {
      // A receipt is named by its cost.
      kind: r.record_type === "expense_receipt" ? "receipt" : "expense",
      vendor: (cost?.vendor_id ? vendorName.get(cost.vendor_id) : null) || cost?.vendor || "A cost",
      customer: customer(cost?.lead_id) ?? customer(r.lead_id),
      amountCents: cost ? Number(cost.amount_cents) : null,
      day: cost?.spent_on ?? null,
      // Only when the costs were read: one that couldn't be read isn't called deleted.
      deleted: !!costs && !cost,
      status: r.status as QuickBooksCostAttention["status"],
      reason: r.reason ?? "",
    };
  });
  return { ...base, counts: { sent, waiting, failed }, attention };
}

export type CostSendingInput = { on: boolean; from: string | null; lenderPayoutsAccount: string | null };

/**
 * Turns sending job costs (lender fees) to QuickBooks on or off, with its
 * start date and the bank account lender payouts land in: only fees dated
 * from it go, so the ones the bookkeeper already entered aren't doubled.
 * Turning it on doesn't need the bank account: fees wait until it's picked.
 */
export async function saveQuickBooksCostSending(input: CostSendingInput): Promise<{ error?: string }> {
  const who = await officeAdmin();
  if (!who) return { error: "Only Office or Admin users can change this." };
  const companyId = who.profile.company_id;
  const { connection } = await readQuickBooksConnection(who.admin, companyId);
  if (!connection?.connected) return { error: "Connect QuickBooks first." };
  // Only whether 0230 has run and the bank accounts: no realm, so nothing is counted.
  const current = await readCostSending(who.admin, companyId, null, connection.accounts ?? []);
  if (!current.ready) return { error: NEEDS_0230 };
  const bankIds = new Set(current.choices.bank.map((a) => a.id));
  const pick = (id: string | null, ok: Set<string>) => (id && ok.has(id) ? id : null);
  if (input.on) {
    if (await isCompanyLocked(companyId)) return { error: (await lockedServicesError(companyId)) ?? "This company is locked." };
    if (!isDay(input.from)) return { error: "Pick the date job costs start from." };
  }
  const { data, error } = await who.admin
    .from("quickbooks_connections")
    .update({
      send_costs: !!input.on,
      send_costs_from: input.on ? input.from : undefined,
      lender_payouts_account_id: pick(input.lenderPayoutsAccount, bankIds),
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .select("company_id");
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0230 : error.message };
  if (!data?.length) return { error: "Connect QuickBooks first." };
  revalidatePath("/settings/quickbooks");
  revalidatePath("/bills");
  return {};
}
