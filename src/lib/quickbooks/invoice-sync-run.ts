import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { companyIanaZone } from "@/lib/data/types";
import { isoDateInZone } from "@/lib/company-clock";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { quickBooksAccess } from "./connection";
import {
  createPaymentMethod,
  createSales,
  deleteSales,
  customerStanding,
  findCustomer,
  findPaymentMethod,
  readPreferences,
  readSales,
  updateSales,
  voidCustomerPayment,
  voidInvoice,
  type QbAccess,
  type QbError,
  type QbPrefs,
  type SalesEntity,
} from "./api";
import type { QbAccount } from "./accounts";
import { inQuickBooks, type InDoubt, type RecordType, type SyncRecord } from "./bill-status";
import { newRequestId, nextTryAt } from "./bill-sync";
import { billJobLinks } from "./bill-jobs";
import {
  SALES_WAIT,
  TOTAL_CHECK,
  creditLinkBody,
  creditMemoBody,
  customerBody,
  customerName,
  customerPaymentBody,
  invoiceBody,
  jobBody,
  jobName,
  planSalesSync,
  qbDocNumber,
  qbPaymentMethodName,
  refundReceiptBody,
  type InvoiceKey,
  type SalesSettings,
  type SalesStep,
  type SyncCredit,
  type SyncDoc,
  type SyncLead,
  type SyncLine,
  type SyncMoney,
  type SyncStage,
} from "./invoice-sync";

/**
 * One company's turn of the QuickBooks invoices job (DECISIONS #183), from
 * the five-minute job (/api/cron/quickbooks-sync) or Send now, before its
 * bills' turn (so a bill's job is there to tag it with).
 *
 * Claims the company (quickbooks_connections.invoices_claimed_until), reads
 * QuickBooks' own settings (custom numbers, auto-applied credits, sales
 * tax, closed books), then the bills to customers dated from the start
 * date, the ones already sent, and what's paid, credited and refunded on
 * them; asks planSalesSync what to do; does it, one QuickBooks call at a
 * time, finding or adding each customer and job as it goes. Before adding
 * anything it writes down the exact request (`doubt`), so a run cut off
 * mid-way is finished by repeating it, never by adding it twice. Stops
 * starting work at the time budget or the write cap.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type InvoiceSyncSummary = {
  sent: number;
  changed: number;
  removed: number;
  waiting: number;
  failed: number;
  more: boolean;
  busy?: boolean;
  error?: string;
};

const IN_CHUNK = 100;
const CLAIM_MINUTES = 6;
const MAX_TRANSIENT = 3;
const GRACE_MS = 25_000;

const RECORD_COLUMNS =
  "record_type, record_id, bill_id, qb_id, qb_hash, tried_hash, doubt, status, failed_op, reason, tries, next_try_at, sent_at";
const DOC_COLUMNS =
  "id, lead_id, kind, status, doc_number, version, supersedes_id, title, parent_estimate_id, signed_at, issued_at, tax_cents, total_cents, deposit_cents, job_address, customer_message";
const STAGE_COLUMNS = "id, estimate_id, sort_order, name, description, amount_cents, requested_at, due_date, cancelled_at";
const MONEY_COLUMNS =
  "id, estimate_id, estimate_payment_id, amount_cents, status, method, reference, note, paid_at, source, refund_of, refund_still_owed, stripe_session_id, stripe_payment_intent_id";
const CREDIT_COLUMNS = "id, estimate_id, estimate_payment_id, amount_cents, reason, refund_payment_id, created_at, removed_at";
const LEAD_COLUMNS = "id, contact_type, company_name, first_name, last_name, email, phone, address, zip, portal_payments_disabled";
const LINE_COLUMNS = "estimate_id, sort_order, name, description, quantity, unit_price_cents, line_total_cents, source_expense_id";

type DocRow = {
  id: string;
  lead_id: string;
  kind: string | null;
  status: string;
  doc_number: string;
  /** A contract revised and signed again keeps its number, one version up, and supersedes the one before. */
  version: number | null;
  supersedes_id: string | null;
  title: string | null;
  parent_estimate_id: string | null;
  signed_at: string | null;
  issued_at: string | null;
  tax_cents: number | null;
  total_cents: number | null;
  deposit_cents: number | null;
  job_address: string | null;
  customer_message: string | null;
};
type StageRow = {
  id: string;
  estimate_id: string;
  sort_order: number;
  name: string | null;
  description: string | null;
  amount_cents: number;
  requested_at: string | null;
  due_date: string | null;
  cancelled_at: string | null;
};
type MoneyRow = {
  id: string;
  estimate_id: string;
  estimate_payment_id: string | null;
  amount_cents: number;
  status: string;
  method: string | null;
  reference: string | null;
  note: string | null;
  paid_at: string | null;
  source: string | null;
  refund_of: string | null;
  refund_still_owed: boolean | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
};
type CreditRow = {
  id: string;
  estimate_id: string;
  estimate_payment_id: string | null;
  amount_cents: number;
  reason: string | null;
  refund_payment_id: string | null;
  created_at: string;
  removed_at: string | null;
};
type LeadRow = {
  id: string;
  contact_type: string | null;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  zip: string | null;
  portal_payments_disabled: boolean | null;
};
type LineRow = {
  estimate_id: string;
  sort_order: number;
  name: string;
  description: string | null;
  quantity: number | string;
  unit_price_cents: number;
  line_total_cents: number;
  source_expense_id: string | null;
};

class StopRun extends Error {}

/** On a customer or job record noted only for bills' job tags (Settings' Needs a look says so). */
export const FOR_BILLS = "for-bills";

/** Every row of a query, page by page; a failed read stops the run (never "no rows"). */
async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function inChunks<T>(ids: string[], read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data, error } = await read(unique.slice(i, i + IN_CHUNK));
    if (error) throw new Error(error.message);
    out.push(...((data as T[] | null) ?? []));
  }
  return out;
}

/** Like inChunks, for reads with many rows per id (a document's lines, stages, payments): each chunk page by page. */
async function inChunksAll<T>(
  ids: string[],
  read: (chunk: string[], from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const chunk = unique.slice(i, i + IN_CHUNK);
    out.push(...(await readAll<T>((from, to) => read(chunk, from, to))));
  }
  return out;
}

const empty = (): InvoiceSyncSummary => ({ sent: 0, changed: 0, removed: 0, waiting: 0, failed: 0, more: false });

const ENTITY: Partial<Record<RecordType, SalesEntity>> = {
  customer: "Customer",
  job: "Customer",
  invoice: "Invoice",
  deposit: "Invoice",
  customer_payment: "Payment",
  credit_link: "Payment",
  credit: "CreditMemo",
  refund: "RefundReceipt",
};

/** QuickBooks' holding account for payments not yet in the bank (Undeposited Funds, "Payments to deposit"). */
export function undepositedFundsId(accounts: QbAccount[]): string | null {
  const found = accounts.find((a) => a.type === "Other Current Asset" && /undeposited funds|payments to deposit/i.test(a.name));
  return found?.id ?? null;
}

type Connection = {
  realm_id: string | null;
  disconnected_at: string | null;
  send_invoices: boolean;
  send_invoices_from: string | null;
  send_bills: boolean | null;
  send_bills_from: string | null;
  invoice_item_id: string | null;
  deposit_item_id: string | null;
  cost_item_id: string | null;
  payments_account_id: string | null;
  stripe_refunds_account_id: string | null;
  hand_refunds_account_id: string | null;
  send_outside_crm: boolean;
  accounts: QbAccount[] | null;
};

export async function syncCompanyInvoices(
  admin: Admin,
  companyId: string,
  opts: { writeCap?: number; budgetMs?: number; force?: boolean; fetchImpl?: typeof fetch } = {}
): Promise<InvoiceSyncSummary> {
  const summary = empty();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { data: conn, error: connError } = await admin
    .from("quickbooks_connections")
    .select(
      "realm_id, disconnected_at, send_invoices, send_invoices_from, send_bills, send_bills_from, invoice_item_id, deposit_item_id, cost_item_id, " +
        "payments_account_id, stripe_refunds_account_id, hand_refunds_account_id, send_outside_crm, accounts"
    )
    .eq("company_id", companyId)
    .maybeSingle<Connection>();
  if (connError) {
    return {
      ...summary,
      error: isMissingSchemaError(connError) ? "QuickBooks needs a database update first: run 0227_quickbooks_invoices.sql in Supabase." : connError.message,
    };
  }
  if (!conn?.realm_id || conn.disconnected_at) return { ...summary, error: "Connect QuickBooks first." };
  if (!conn.send_invoices || !conn.send_invoices_from) return { ...summary, error: "Sending invoices to QuickBooks is off." };
  const realmId = conn.realm_id;

  const started = new Date();
  const { data: claimed, error: claimError } = await admin
    .from("quickbooks_connections")
    .update({ invoices_claimed_until: new Date(started.getTime() + CLAIM_MINUTES * 60_000).toISOString() })
    .eq("company_id", companyId)
    .or(`invoices_claimed_until.is.null,invoices_claimed_until.lt."${started.toISOString()}"`)
    .select("company_id");
  if (claimError) return { ...summary, error: claimError.message };
  if (!claimed?.length) return { ...summary, busy: true };

  try {
    const got = await quickBooksAccess(admin, companyId, fetchImpl);
    if ("error" in got) return { ...summary, error: got.error };
    if (got.access.realmId !== realmId) return { ...summary, error: "QuickBooks needs you to connect again." };
    const prefs = await readPreferences(got.access, fetchImpl);
    if ("error" in prefs) {
      if (prefs.error.kind === "auth") {
        await admin.from("quickbooks_connections").update({ last_error: prefs.error.message, updated_at: new Date().toISOString() }).eq("company_id", companyId);
      }
      return { ...summary, error: prefs.error.message };
    }
    await admin
      .from("quickbooks_connections")
      .update({ qb_prefs: prefs.prefs, qb_prefs_read_at: new Date().toISOString() })
      .eq("company_id", companyId);
    await run(admin, companyId, conn, prefs.prefs, got.access, fetchImpl, opts, summary);
    return summary;
  } finally {
    await admin
      .from("quickbooks_connections")
      .update({ invoices_claimed_until: null, invoices_checked_at: new Date().toISOString() })
      .eq("company_id", companyId);
  }
}

async function run(
  admin: Admin,
  companyId: string,
  conn: Connection,
  prefs: QbPrefs,
  access: QbAccess,
  baseFetch: typeof fetch,
  opts: { writeCap?: number; budgetMs?: number; force?: boolean },
  summary: InvoiceSyncSummary
) {
  const realmId = conn.realm_id!;
  const sendFrom = conn.send_invoices_from!;
  const deadline = Date.now() + (opts.budgetMs ?? 120_000);
  const cap = opts.writeCap ?? 100;
  const hardStop = deadline + GRACE_MS;
  const fetchImpl = ((url: string, init: RequestInit = {}) => {
    const left = Math.max(1_000, hardStop - Date.now());
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(left)]) : AbortSignal.timeout(left);
    return baseFetch(url, { ...init, signal });
  }) as typeof fetch;

  // ---------------------------------------------------------------- the company's calendar
  const { data: profile, error: profileError } = await admin
    .from("company_profile")
    .select("timezone")
    .eq("company_id", companyId)
    .maybeSingle<{ timezone: string | null }>();
  // Every day sent hangs on it: a failed read stops the run, like every other read.
  if (profileError) throw new Error(profileError.message);
  const zone = companyIanaZone(profile?.timezone);
  const day = (iso: string) => (iso ? isoDateInZone(new Date(iso), zone) : "");
  // A day early, so a bill late in the evening of the day before (UTC) isn't missed; the plan checks the real day.
  const since = new Date(new Date(`${sendFrom}T00:00:00Z`).getTime() - 86_400_000).toISOString();

  // ---------------------------------------------------------------- read
  const records = await readAll<SyncRecord>((f, t) =>
    admin
      .from("quickbooks_sync")
      .select(RECORD_COLUMNS)
      .eq("company_id", companyId)
      .eq("realm_id", realmId)
      .order("record_type")
      .order("record_id")
      .range(f, t)
  );
  const idsOf = (...types: RecordType[]) => records.filter((r) => types.includes(r.record_type)).map((r) => r.record_id);

  // What's new since the start date, and what was sent before.
  const [billedStages, newMoney, signedDocs, issuedDocs] = await Promise.all([
    readAll<StageRow>((f, t) =>
      admin.from("estimate_payments").select(STAGE_COLUMNS).eq("company_id", companyId).gte("requested_at", since).order("id").range(f, t)
    ),
    readAll<MoneyRow>((f, t) =>
      admin
        .from("portal_payments")
        .select(MONEY_COLUMNS)
        .eq("company_id", companyId)
        .or(`paid_at.gte."${since}",created_at.gte."${since}"`)
        .order("id")
        .range(f, t)
    ),
    readAll<DocRow>((f, t) =>
      admin
        .from("estimates")
        .select(DOC_COLUMNS)
        .eq("company_id", companyId)
        .in("kind", ["contract", "change_order"])
        .in("status", ["Signed", "Void"])
        .gte("signed_at", since)
        .order("id")
        .range(f, t)
    ),
    readAll<DocRow>((f, t) =>
      admin
        .from("estimates")
        .select(DOC_COLUMNS)
        .eq("company_id", companyId)
        .eq("kind", "invoice")
        .in("status", ["Signed", "Void"])
        .gte("issued_at", since)
        .order("id")
        .range(f, t)
    ),
  ]);
  const trackedStages = await inChunks<StageRow>(idsOf("invoice"), (chunk) =>
    admin.from("estimate_payments").select(STAGE_COLUMNS).eq("company_id", companyId).in("id", chunk)
  );
  const trackedMoney = await inChunks<MoneyRow>(idsOf("customer_payment", "refund"), (chunk) =>
    admin.from("portal_payments").select(MONEY_COLUMNS).eq("company_id", companyId).in("id", chunk)
  );
  const trackedCredits = await inChunks<CreditRow>(idsOf("credit"), (chunk) =>
    admin.from("bill_credits").select(CREDIT_COLUMNS).eq("company_id", companyId).in("id", chunk)
  );

  // Every document behind them, their contracts, and the change orders on those contracts.
  const docIds = new Set<string>([
    ...billedStages.map((s) => s.estimate_id),
    ...trackedStages.map((s) => s.estimate_id),
    ...newMoney.map((m) => m.estimate_id),
    ...trackedMoney.map((m) => m.estimate_id),
    ...trackedCredits.map((c) => c.estimate_id),
    ...signedDocs.map((d) => d.id),
    ...issuedDocs.map((d) => d.id),
    ...idsOf("deposit"),
  ]);
  const docRows = new Map<string, DocRow>([...signedDocs, ...issuedDocs].map((d) => [d.id, d]));
  const loadDocs = async (ids: string[]) => {
    const missing = ids.filter((id) => id && !docRows.has(id));
    for (const d of await inChunks<DocRow>(missing, (chunk) => admin.from("estimates").select(DOC_COLUMNS).eq("company_id", companyId).in("id", chunk))) {
      docRows.set(d.id, d);
    }
  };
  await loadDocs([...docIds]);
  // Parents (contracts of change orders and invoices), then the change orders on every contract (their mirror rows).
  await loadDocs([...docRows.values()].map((d) => d.parent_estimate_id ?? ""));
  // Every version of those contracts (a revision copies a change order's line: it's counted once across them).
  const loadedContracts = [...docRows.values()].filter((d) => d.kind === "contract");
  const versions = await inChunksAll<DocRow>([...new Set(loadedContracts.map((d) => d.doc_number))], (chunk, f, t) =>
    admin.from("estimates").select(DOC_COLUMNS).eq("company_id", companyId).eq("kind", "contract").in("doc_number", chunk).order("id").range(f, t)
  );
  const familyLeads = new Set(loadedContracts.map((d) => `${d.lead_id}:${d.doc_number}`));
  for (const d of versions) if (familyLeads.has(`${d.lead_id}:${d.doc_number}`) && !docRows.has(d.id)) docRows.set(d.id, d);
  const contracts = [...docRows.values()].filter((d) => d.kind === "contract").map((d) => d.id);
  const changeOrders = await inChunksAll<DocRow>(contracts, (chunk, f, t) =>
    admin
      .from("estimates")
      .select(DOC_COLUMNS)
      .eq("company_id", companyId)
      .eq("kind", "change_order")
      .in("parent_estimate_id", chunk)
      .order("id")
      .range(f, t)
  );
  for (const d of changeOrders) docRows.set(d.id, d);
  const allDocIds = [...docRows.keys()];

  const [stageRows, moneyRows, creditRows, lineRows] = await Promise.all([
    inChunksAll<StageRow>(allDocIds, (chunk, f, t) =>
      admin.from("estimate_payments").select(STAGE_COLUMNS).eq("company_id", companyId).in("estimate_id", chunk).order("id").range(f, t)
    ),
    inChunksAll<MoneyRow>(allDocIds, (chunk, f, t) =>
      admin.from("portal_payments").select(MONEY_COLUMNS).eq("company_id", companyId).in("estimate_id", chunk).order("id").range(f, t)
    ),
    inChunksAll<CreditRow>(allDocIds, (chunk, f, t) =>
      admin.from("bill_credits").select(CREDIT_COLUMNS).eq("company_id", companyId).in("estimate_id", chunk).order("id").range(f, t)
    ),
    inChunksAll<LineRow>(
      [...docRows.values()].filter((d) => d.kind === "invoice").map((d) => d.id),
      (chunk, f, t) => admin.from("estimate_items").select(LINE_COLUMNS).eq("company_id", companyId).in("estimate_id", chunk).order("id").range(f, t)
    ),
  ]);

  // Bills to tag with their job (step 2's), when bills go to QuickBooks too.
  const billRows = conn.send_bills
    ? await readAll<{ id: string; lead_id: string | null; estimate_payment_id: string | null }>((f, t) =>
        admin.from("vendor_bills").select("id, lead_id, estimate_payment_id").eq("company_id", companyId).not("lead_id", "is", null).order("id").range(f, t)
      )
    : [];
  const sentBills = new Set(records.filter((r) => r.record_type === "bill" && inQuickBooks(r)).map((r) => r.record_id));
  const links = await billJobLinks(admin, companyId, billRows.filter((b) => sentBills.has(b.id)));
  await loadDocs([...links.values()].map((l) => l.contractId ?? ""));

  const leadIds = [...new Set([...[...docRows.values()].map((d) => d.lead_id), ...[...links.values()].map((l) => l.leadId)])];
  const leadRows = await inChunks<LeadRow>(leadIds, (chunk) => admin.from("leads").select(LEAD_COLUMNS).eq("company_id", companyId).in("id", chunk));

  // ---------------------------------------------------------------- shape it for the plan
  const leads: SyncLead[] = leadRows.map((l) => ({
    id: l.id,
    contactType: l.contact_type,
    companyName: l.company_name,
    firstName: l.first_name,
    lastName: l.last_name,
    email: l.email,
    phone: l.phone,
    address: l.address,
    zip: l.zip,
    outside: !!l.portal_payments_disabled,
  }));
  const docs: SyncDoc[] = [...docRows.values()]
    .sort((a, b) => (a.signed_at ?? a.issued_at ?? "").localeCompare(b.signed_at ?? b.issued_at ?? "") || a.id.localeCompare(b.id))
    .map((d) => ({
      id: d.id,
      leadId: d.lead_id,
      kind: d.kind,
      status: d.status,
      docNumber: qbDocNumber(d),
      familyNumber: d.doc_number,
      title: d.title,
      parentId: d.parent_estimate_id,
      signedAt: d.signed_at,
      issuedAt: d.issued_at,
      taxCents: Number(d.tax_cents ?? 0),
      totalCents: Number(d.total_cents ?? 0),
      depositCents: d.kind === "invoice" ? 0 : Number(d.deposit_cents ?? 0),
      jobAddress: d.job_address,
      customerMessage: d.customer_message,
    }));
  const stages: SyncStage[] = [...new Map(stageRows.map((s) => [s.id, s])).values()].map((s) => ({
    id: s.id,
    docId: s.estimate_id,
    sortOrder: Number(s.sort_order ?? 0),
    name: s.name,
    description: s.description,
    amountCents: Number(s.amount_cents),
    requestedAt: s.requested_at,
    dueDate: s.due_date,
    cancelledAt: s.cancelled_at,
  }));
  const money: SyncMoney[] = [...new Map(moneyRows.map((m) => [m.id, m])).values()].map((m) => ({
    id: m.id,
    docId: m.estimate_id,
    stageId: m.estimate_payment_id,
    amountCents: Number(m.amount_cents),
    status: m.status,
    method: m.method,
    reference: m.reference,
    note: m.note,
    paidAt: m.paid_at,
    source: m.source,
    refundOf: m.refund_of,
    stillOwed: m.refund_still_owed,
    unfinished: m.status === "pending" && !!m.stripe_session_id && !m.stripe_payment_intent_id,
  }));
  const credits: SyncCredit[] = creditRows.map((c) => ({
    id: c.id,
    docId: c.estimate_id,
    stageId: c.estimate_payment_id,
    amountCents: Number(c.amount_cents),
    reason: c.reason,
    createdAt: c.created_at,
    removed: !!c.removed_at,
    fromRefund: !!c.refund_payment_id,
    refundId: c.refund_payment_id,
  }));
  const lines: SyncLine[] = lineRows.map((l) => ({
    docId: l.estimate_id,
    sortOrder: Number(l.sort_order ?? 0),
    name: l.name,
    description: l.description,
    qty: Number(l.quantity),
    unitCents: Number(l.unit_price_cents),
    totalCents: Number(l.line_total_cents),
    cost: !!l.source_expense_id,
  }));
  const settings: SalesSettings = {
    jobItem: conn.invoice_item_id,
    depositItem: conn.deposit_item_id,
    costItem: conn.cost_item_id,
    paymentsAccount: conn.payments_account_id,
    stripeRefundsAccount: conn.stripe_refunds_account_id,
    handRefundsAccount: conn.hand_refunds_account_id,
    sendOutside: !!conn.send_outside_crm,
  };

  const steps = planSalesSync({
    leads,
    docs,
    stages,
    lines,
    money,
    credits,
    records,
    sendFrom,
    now: new Date(),
    day,
    settings,
    prefs,
    force: opts.force,
    billLinks: [...links.values()],
  });

  // ---------------------------------------------------------------- write
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const docById = new Map(docs.map((d) => [d.id, d]));
  const recOf = new Map(records.map((r) => [`${r.record_type}:${r.record_id}`, r]));
  // QuickBooks' id for each record, as it stands during this run.
  const qb = new Map(records.filter((r) => inQuickBooks(r)).map((r) => [`${r.record_type}:${r.record_id}`, r.qb_id!]));
  const methodIds = new Map<string, string | null>();
  // Invoices whose credits didn't all come off this run: not voided or deleted yet.
  const held = new Set<string>();
  // Invoices whose total in QuickBooks came back different this run: nothing more goes on them.
  const mismatched = new Set<string>();
  let writes = 0;
  let transient = 0;

  const save = async (type: RecordType, id: string, billId: string | null, fields: Partial<SyncRecord>) => {
    const { error } = await admin.from("quickbooks_sync").upsert(
      { company_id: companyId, realm_id: realmId, record_type: type, record_id: id, bill_id: billId, ...fields, updated_at: new Date().toISOString() },
      { onConflict: "company_id,realm_id,record_type,record_id" }
    );
    if (error) throw new Error(error.message);
    // The run's own copy follows, so a later step this run reads it as it now stands.
    const key = `${type}:${id}`;
    const before = recOf.get(key) ?? {
      record_type: type,
      record_id: id,
      bill_id: billId,
      qb_id: null,
      qb_hash: null,
      tried_hash: null,
      doubt: null,
      status: "waiting" as const,
      failed_op: null,
      reason: null,
      tries: 0,
      next_try_at: null,
      sent_at: null,
    };
    recOf.set(key, { ...before, bill_id: billId, ...fields });
  };
  const drop = async (type: RecordType, id: string) => {
    const { error } = await admin
      .from("quickbooks_sync")
      .delete()
      .eq("company_id", companyId)
      .eq("realm_id", realmId)
      .eq("record_type", type)
      .eq("record_id", id);
    if (error) throw new Error(error.message);
  };
  const sentNow = (qbId: string, hash: string): Partial<SyncRecord> => ({
    status: "sent",
    qb_id: qbId,
    qb_hash: hash,
    tried_hash: null,
    doubt: null,
    failed_op: null,
    reason: null,
    tries: 0,
    next_try_at: null,
    sent_at: new Date().toISOString(),
  });
  const stopIf = async (err: QbError) => {
    if (err.kind === "auth") {
      await admin.from("quickbooks_connections").update({ last_error: err.message, updated_at: new Date().toISOString() }).eq("company_id", companyId);
      throw new StopRun(err.message);
    }
    if (err.kind === "throttle") throw new StopRun(err.message);
  };
  const isTransient = (err: QbError) => err.kind === "transient" || err.kind === "stale";
  const countTransient = (err: QbError) => {
    transient += 1;
    if (transient >= MAX_TRANSIENT) throw new StopRun(err.message);
  };
  const refusedAt = async (type: RecordType, id: string, billId: string | null, record: SyncRecord | null, hash: string, err: QbError, op: "add" | "change") => {
    const tries = (record?.failed_op === op ? record.tries : 0) + 1;
    await save(type, id, billId, { status: "failed", failed_op: op, reason: err.message, tried_hash: hash, doubt: null, tries, next_try_at: nextTryAt(tries, new Date()) });
    // Customers and jobs aren't counted; the bill waiting on one is.
    if (type !== "customer" && type !== "job") summary.failed += 1;
  };
  const removalRefused = async (type: RecordType, r: SyncRecord, what: string, err: QbError) => {
    const tries = (r.failed_op === "remove" ? r.tries : 0) + 1;
    await save(type, r.record_id, r.bill_id, {
      status: "failed",
      failed_op: "remove",
      reason: `Couldn't ${what} it in QuickBooks. ${err.message}`,
      tries,
      next_try_at: nextTryAt(tries, new Date()),
    });
    summary.failed += 1;
  };
  const waitAt = async (type: RecordType, id: string, billId: string | null, record: SyncRecord | null, hash: string, reason: string) => {
    const tries = (record?.tries ?? 0) + 1;
    await save(type, id, billId, { status: "waiting", reason, tried_hash: hash, tries, next_try_at: nextTryAt(tries, new Date()) });
    summary.waiting += 1;
  };
  /** Something QuickBooks didn't answer while finding a customer or job: the thing waiting on it says so meanwhile. */
  const troubleAt = async (type: RecordType, id: string, billId: string | null, record: SyncRecord | null, hash: string, err: QbError) => {
    await stopIf(err);
    if (isTransient(err)) {
      if (!inQuickBooks(record)) await save(type, id, billId, { status: "waiting", reason: err.message, tried_hash: hash, next_try_at: null });
      return countTransient(err);
    }
    return refusedAt(type, id, billId, record, hash, err, inQuickBooks(record) ? "change" : "add");
  };

  /**
   * Adds one. The exact request is written down first; if no answer comes
   * it stays written down and the next run repeats it (same request id:
   * QuickBooks answers a repeat without adding it again).
   */
  const add = async (
    type: RecordType,
    id: string,
    billId: string | null,
    record: SyncRecord | null,
    doubt: InDoubt
  ): Promise<{ id: string; total: number | null } | { refused: QbError } | null> => {
    await save(type, id, billId, record ? { doubt } : { doubt, status: "waiting", reason: "Being sent to QuickBooks now." });
    writes += 1;
    const res = await createSales(access, ENTITY[type]!, doubt.body, doubt.requestId, fetchImpl);
    if (!("error" in res)) {
      await save(type, id, billId, sentNow(res.id, doubt.hash));
      qb.set(`${type}:${id}`, res.id);
      if (type !== "customer" && type !== "job" && type !== "credit_link") summary.sent += 1;
      return { id: res.id, total: res.total };
    }
    await stopIf(res.error);
    if (isTransient(res.error)) {
      await save(type, id, billId, { status: "waiting", reason: res.error.message, tried_hash: doubt.hash, next_try_at: null });
      countTransient(res.error);
      return null;
    }
    await refusedAt(type, id, billId, record, doubt.hash, res.error, "add");
    return { refused: res.error };
  };

  /** An invoice QuickBooks totals differently (it added tax): kept, noted, its payments wait. */
  const checkTotal = async (type: RecordType, id: string, qbId: string, total: number | null, crmCents: number, hash: string) => {
    if (total === null || Math.round(total * 100) === crmCents) return;
    mismatched.add(id);
    await save(type, id, id, {
      status: "waiting",
      qb_id: qbId,
      qb_hash: hash,
      reason: SALES_WAIT.mismatch(Math.round(total * 100), crmCents),
      tried_hash: `${TOTAL_CHECK}${hash}`,
      tries: 1,
      next_try_at: nextTryAt(1, new Date()),
    });
    summary.sent -= 1;
    summary.waiting += 1;
  };

  /** A change to something QuickBooks has dated in a month its books have closed: waits, saying to make it there. */
  const closedThere = (txnDate: string | null) => !!prefs.bookCloseDate && !!txnDate && txnDate <= prefs.bookCloseDate;

  /** A payment, credit or refund on an invoice whose total just came back wrong waits, as the next run's plan would say. */
  const waitOnTotal = async (type: RecordType, id: string, invoiceId: string, hash: string) => {
    await save(type, id, invoiceId, { status: "waiting", reason: SALES_WAIT.mismatchChild, tried_hash: hash, next_try_at: null });
    summary.waiting += 1;
  };

  /**
   * QuickBooks refused something as naming what isn't there (code 610: "made
   * inactive", or merged away). If it's the job or customer, the CRM stops
   * using it and looks it up by name again next time.
   */
  const recheckRefs = async (who: { leadId: string; contractId: string | null }) => {
    for (const [type, id] of [
      ["job", who.contractId],
      ["customer", who.leadId],
    ] as const) {
      const qbId = id ? qb.get(`${type}:${id}`) : undefined;
      if (!id || !qbId) continue;
      const res = await customerStanding(access, qbId, fetchImpl);
      if ("error" in res || res.standing === "active") continue;
      const reason = res.standing === "inactive" ? "Made inactive in QuickBooks." : "No longer in QuickBooks (merged or deleted there).";
      await save(type, id, null, { status: "gone", reason, next_try_at: null });
      qb.delete(`${type}:${id}`);
    }
  };
  const refusedAsMissing = (res: Awaited<ReturnType<typeof add>>) => !!res && "refused" in res && res.refused.kind === "notfound";
  /** The same for the invoice a payment or credit goes on: deleted in QuickBooks, it's left alone from now on ("gone"). True if so. */
  const recheckInvoice = async (key: InvoiceKey): Promise<boolean> => {
    const qbId = qb.get(keyOf(key));
    if (!qbId) return false;
    const current = await readSales(access, "Invoice", qbId, fetchImpl);
    const deleted = "error" in current && current.error.kind === "notfound";
    // Voided there by the bookkeeper (not by the CRM): left alone the same way.
    const voided = !("error" in current) && current.voided;
    if (!deleted && !voided) return false;
    const reason = deleted ? "Deleted in QuickBooks, so the CRM doesn't send it again." : "Voided in QuickBooks, so the CRM doesn't send to it again.";
    await save(key.type, key.id, key.id, { status: "gone", reason, next_try_at: null });
    qb.delete(keyOf(key));
    return true;
  };
  /** A credit memo the CRM sent, deleted in QuickBooks before its $0.00 payment went: left alone from now on. */
  const recheckCreditMemo = async (creditId: string, invoiceId: string) => {
    const qbId = qb.get(`credit:${creditId}`);
    if (!qbId) return;
    const current = await readSales(access, "CreditMemo", qbId, fetchImpl);
    if (!("error" in current) || current.error.kind !== "notfound") return;
    const gone = { status: "gone" as const, reason: "Deleted in QuickBooks, so the CRM doesn't send it again.", next_try_at: null };
    await save("credit", creditId, invoiceId, gone);
    await save("credit_link", creditId, invoiceId, gone);
    qb.delete(`credit:${creditId}`);
  };

  /**
   * A customer or job wanted only for bills' job tags that can't be added: noted
   * on its own record with the reason (shown under Needs a look), backing off. A
   * record in doubt is left as it is; one gone from QuickBooks keeps that status.
   */
  const noteWait = async (type: "customer" | "job", id: string, reason: string) => {
    const r = recOf.get(`${type}:${id}`) ?? null;
    if (r?.doubt) return;
    // Just refused (recorded with its own back-off): only marked as wanted for bills.
    if (r?.status === "failed") {
      if (r.tried_hash !== FOR_BILLS) await save(type, id, null, { tried_hash: FOR_BILLS });
      return;
    }
    if (r?.status === "waiting" && r.reason === reason && !!r.next_try_at && new Date(r.next_try_at).getTime() > Date.now()) return;
    const tries = (r?.tries ?? 0) + 1;
    const next_try_at = nextTryAt(tries, new Date());
    // tried_hash marks it as wanted for bills' job tags (Needs a look says so).
    await save(type, id, null, r?.status === "gone" ? { reason, tries, next_try_at } : { status: "waiting", reason, tries, next_try_at, tried_hash: FOR_BILLS });
  };

  // ------------------------------------------------ customers and jobs
  type Ref = { id: string } | { wait: string } | { error: QbError };

  // Customers whose add got no answer, by name (lower case): written down at an earlier run, or this one.
  const doubtedNames = new Map<string, string[]>();
  for (const x of records) {
    const shown = (x.doubt?.body as { DisplayName?: unknown } | undefined)?.DisplayName;
    if (x.record_type !== "customer" || typeof shown !== "string") continue;
    doubtedNames.set(shown.toLowerCase(), [...(doubtedNames.get(shown.toLowerCase()) ?? []), x.record_id]);
  }

  const customerFor = async (leadId: string): Promise<Ref> => {
    const known = qb.get(`customer:${leadId}`);
    if (known) return { id: known };
    const lead = leadById.get(leadId);
    if (!lead) return { wait: SALES_WAIT.billFirst };
    const r = recOf.get(`customer:${leadId}`) ?? null;
    if (r?.doubt) return { wait: "Waits for its customer to go to QuickBooks first." };
    const name = customerName(lead);
    if (!name) return { wait: "Give this customer a name QuickBooks can take, in plain letters." };
    const sameName = `Another customer in the CRM already went to QuickBooks as "${name}". Add something to this one's name to tell them apart, like a middle initial.`;
    // Another customer's add under this name got no answer yet: QuickBooks may already have it as theirs.
    if (doubtedNames.get(name.toLowerCase())?.some((other) => other !== leadId)) return { wait: sameName };
    const found = await findCustomer(access, name, fetchImpl);
    if ("error" in found) return found;
    if (found.customer) {
      if (!found.customer.active) return { wait: `The QuickBooks customer "${name}" is inactive. Make it active in QuickBooks and it goes.` };
      if (found.customer.parentId) return { wait: `QuickBooks already has a job named "${name}". Rename one of them so they differ.` };
      // Never two CRM customers as one: the second waits.
      const id = found.customer.id;
      const taken = [...qb.entries()].some(([key, v]) => key.startsWith("customer:") && key !== `customer:${leadId}` && v === id);
      if (taken || records.some((x) => x.record_type === "customer" && x.qb_id === id && x.record_id !== leadId)) return { wait: sameName };
      await save("customer", leadId, null, sentNow(found.customer.id, "found"));
      qb.set(`customer:${leadId}`, found.customer.id);
      return { id: found.customer.id };
    }
    // Gone from QuickBooks (merged away): its old id is no use, and mustn't come back if this add fails.
    if (r?.status === "gone" && r.qb_id) await save("customer", leadId, null, { qb_id: null });
    const made = await add("customer", leadId, null, r, { requestId: newRequestId(), body: customerBody(lead), hash: "added" });
    if (made && "id" in made) return { id: made.id };
    if (!made) doubtedNames.set(name.toLowerCase(), [...(doubtedNames.get(name.toLowerCase()) ?? []), leadId]);
    if (made && made.refused.kind === "duplicate") {
      const reason = `QuickBooks already has a vendor or employee named "${name}". Change the name on one of them so they differ.`;
      await save("customer", leadId, null, { reason });
      return { wait: reason };
    }
    return { wait: made ? made.refused.message : "Waits for its customer to go to QuickBooks first." };
  };

  const jobFor = async (contractId: string, customerQbId: string): Promise<Ref> => {
    const known = qb.get(`job:${contractId}`);
    if (known) return { id: known };
    const doc = docById.get(contractId);
    if (!doc) return { wait: SALES_WAIT.billFirst };
    const r = recOf.get(`job:${contractId}`) ?? null;
    if (r?.doubt) return { wait: "Waits for its job to go to QuickBooks first." };
    const name = jobName(doc);
    const found = await findCustomer(access, name, fetchImpl);
    if ("error" in found) return found;
    if (found.customer) {
      if (found.customer.parentId !== customerQbId) {
        return { wait: `QuickBooks already has a customer or job named "${name}". Rename that one in QuickBooks.` };
      }
      if (!found.customer.active) return { wait: `The QuickBooks job "${name}" is inactive. Make it active in QuickBooks and it goes.` };
      await save("job", contractId, null, sentNow(found.customer.id, "found"));
      qb.set(`job:${contractId}`, found.customer.id);
      return { id: found.customer.id };
    }
    if (r?.status === "gone" && r.qb_id) await save("job", contractId, null, { qb_id: null });
    const made = await add("job", contractId, null, r, { requestId: newRequestId(), body: jobBody(doc, customerQbId), hash: "added" });
    if (made && "id" in made) return { id: made.id };
    // Refused as naming what isn't there: its customer was made inactive or merged away in QuickBooks.
    if (refusedAsMissing(made)) await recheckRefs({ leadId: doc.leadId, contractId: null });
    return { wait: made ? made.refused.message : "Waits for its job to go to QuickBooks first." };
  };

  /** The customer, or the job under it, a bill and what's on it go on. */
  const refFor = async (leadId: string, contractId: string | null): Promise<Ref> => {
    const customer = await customerFor(leadId);
    if (!("id" in customer) || !contractId) return customer;
    // The job's contract must be one of this customer's (a change order's parent always is).
    const doc = docById.get(contractId);
    if (!doc || doc.leadId !== leadId) return customer;
    return jobFor(contractId, customer.id);
  };

  /** QuickBooks' payment method for the CRM's, found or added; none rather than holding a payment up. */
  const methodFor = async (method: string | null): Promise<{ id: string | null } | { error: QbError }> => {
    const name = qbPaymentMethodName(method);
    if (methodIds.has(name)) return { id: methodIds.get(name)! };
    // No answer (or QuickBooks wants a pause): the payment waits for the next run rather than going without its method for good.
    const passing = (err: QbError) => isTransient(err) || err.kind === "auth" || err.kind === "throttle";
    let id: string | null = null;
    const found = await findPaymentMethod(access, name, fetchImpl);
    if ("error" in found) {
      if (passing(found.error)) return found;
    } else {
      id = found.id;
      if (!id) {
        writes += 1;
        const made = await createPaymentMethod(access, name, method === "card", newRequestId(), fetchImpl);
        if ("error" in made && passing(made.error)) return made;
        if (!("error" in made)) id = made.id;
      }
    }
    methodIds.set(name, id);
    return { id };
  };
  /** The method for a payment or refund; null to hold it this run (stopped, or counted as no answer). */
  const methodOrHold = async (method: string | null): Promise<{ id: string | null } | null> => {
    const res = await methodFor(method);
    if (!("error" in res)) return res;
    await stopIf(res.error);
    countTransient(res.error);
    return null;
  };

  const items = {
    job: settings.jobItem ?? "",
    deposit: settings.depositItem ?? settings.jobItem ?? "",
    cost: settings.costItem ?? settings.jobItem ?? "",
  };
  const keyOf = (k: InvoiceKey) => `${k.type}:${k.id}`;
  const crmCentsOf = (body: unknown) =>
    Math.round(((body as { Line?: { Amount?: number }[] } | null)?.Line ?? []).reduce((t, l) => t + Number(l.Amount ?? 0), 0) * 100);

  // ------------------------------------------------ each step
  const doStep = async (step: SalesStep): Promise<void> => {
    switch (step.op) {
      case "drop":
        await drop(step.recordType, step.recordId);
        return;
      case "settle":
        await save(step.recordType, step.recordId, recOf.get(`${step.recordType}:${step.recordId}`)?.bill_id ?? step.recordId, {
          status: "sent",
          failed_op: null,
          reason: null,
          tried_hash: null,
          tries: 0,
          next_try_at: null,
        });
        return;
      case "unneeded":
        await save(step.recordType, step.recordId, step.billId, { status: "removed", qb_id: null, reason: step.reason, tried_hash: null, next_try_at: null, tries: 0 });
        return;
      case "wait":
        await save(step.recordType, step.recordId, step.billId, { status: "waiting", reason: step.reason, tried_hash: step.hash, next_try_at: null });
        summary.waiting += 1;
        return;

      case "resolve": {
        const r = step.record;
        const res = await add(r.record_type, r.record_id, r.bill_id, r, r.doubt!);
        if (res && "id" in res && (r.record_type === "invoice" || r.record_type === "deposit")) {
          await checkTotal(r.record_type, r.record_id, res.id, res.total, crmCentsOf(r.doubt!.body), r.doubt!.hash);
        }
        return;
      }

      case "ensure_customer": {
        const ref = await customerFor(step.leadId);
        if ("wait" in ref) return noteWait("customer", step.leadId, ref.wait);
        if ("error" in ref) {
          await stopIf(ref.error);
          if (isTransient(ref.error)) countTransient(ref.error);
        }
        return;
      }
      case "ensure_job": {
        const customer = await customerFor(step.leadId);
        if ("wait" in customer) return noteWait("customer", step.leadId, customer.wait);
        const ref = "id" in customer ? await refFor(step.leadId, step.contractId) : customer;
        if ("wait" in ref) return noteWait("job", step.contractId, ref.wait);
        if ("error" in ref) {
          await stopIf(ref.error);
          if (isTransient(ref.error)) countTransient(ref.error);
        }
        return;
      }

      case "create_invoice": {
        const { spec, hash, record } = step;
        const ref = await refFor(spec.leadId, spec.contractId);
        if ("wait" in ref) return waitAt(spec.key.type, spec.key.id, spec.key.id, record, hash, ref.wait);
        if ("error" in ref) return troubleAt(spec.key.type, spec.key.id, spec.key.id, record, hash, ref.error);
        const body = invoiceBody(spec, { customerId: ref.id, items, salesTax: prefs.salesTax });
        const res = await add(spec.key.type, spec.key.id, spec.key.id, record, { requestId: newRequestId(), body, hash });
        if (res && "id" in res) await checkTotal(spec.key.type, spec.key.id, res.id, res.total, spec.amountCents, hash);
        if (refusedAsMissing(res)) await recheckRefs(spec);
        return;
      }
      case "update_invoice": {
        const { spec, hash, record } = step;
        writes += 1;
        let result: Awaited<ReturnType<typeof updateSales>> | null = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const current = await readSales(access, "Invoice", record!.qb_id!, fetchImpl);
          if ("error" in current) {
            if (current.error.kind === "notfound") {
              await save(spec.key.type, spec.key.id, spec.key.id, { status: "gone", reason: "Deleted in QuickBooks, so the CRM doesn't send it again.", tried_hash: hash, next_try_at: null });
              qb.delete(keyOf(spec.key));
              summary.failed += 1;
              return;
            }
            result = current;
            break;
          }
          // Voided there by the bookkeeper: left alone from now on, as a deleted one is.
          if (current.voided) {
            await save(spec.key.type, spec.key.id, spec.key.id, { status: "gone", reason: "Voided in QuickBooks, so the CRM doesn't send to it again.", next_try_at: null });
            qb.delete(keyOf(spec.key));
            return;
          }
          // QuickBooks has it dated in a month its books have closed: the change waits, saying so.
          if (closedThere(current.txnDate)) return waitAt(spec.key.type, spec.key.id, spec.key.id, record, hash, SALES_WAIT.closedChange(prefs.bookCloseDate!));
          result = await updateSales(access, "Invoice", { Id: current.id, SyncToken: current.syncToken, TxnDate: spec.txnDay, DueDate: spec.dueDay }, newRequestId(), fetchImpl);
          if (!("error" in result) || result.error.kind !== "stale") break;
        }
        if (result && !("error" in result)) {
          await save(spec.key.type, spec.key.id, spec.key.id, sentNow(result.id, hash));
          summary.changed += 1;
          return;
        }
        const err = result!.error;
        await stopIf(err);
        if (isTransient(err)) return countTransient(err);
        return refusedAt(spec.key.type, spec.key.id, spec.key.id, record, hash, err, "change");
      }
      case "recheck_invoice": {
        const { spec, record } = step;
        const current = await readSales(access, "Invoice", record.qb_id!, fetchImpl);
        if ("error" in current) {
          if (current.error.kind === "notfound") {
            await save(spec.key.type, spec.key.id, spec.key.id, { status: "gone", reason: "Deleted in QuickBooks, so the CRM doesn't send it again.", next_try_at: null });
            qb.delete(keyOf(spec.key));
            return;
          }
          await stopIf(current.error);
          if (isTransient(current.error)) return countTransient(current.error);
          return;
        }
        // Voided there by the bookkeeper (to enter it by hand, say): left alone from now on.
        if (current.voided) {
          await save(spec.key.type, spec.key.id, spec.key.id, { status: "gone", reason: "Voided in QuickBooks, so the CRM doesn't send to it again.", next_try_at: null });
          qb.delete(keyOf(spec.key));
          return;
        }
        if (current.total !== null && Math.round(current.total * 100) === spec.amountCents) {
          await save(spec.key.type, spec.key.id, spec.key.id, { status: "sent", reason: null, tried_hash: null, tries: 0, next_try_at: null });
          return;
        }
        const tries = record.tries + 1;
        await save(spec.key.type, spec.key.id, spec.key.id, { tries, next_try_at: nextTryAt(tries, new Date()) });
        return;
      }
      case "void_invoice":
      case "delete_invoice": {
        const r = step.record;
        if (held.has(r.record_id)) return;
        writes += 1;
        const current = await readSales(access, "Invoice", r.qb_id!, fetchImpl);
        let err: QbError | null = "error" in current && current.error.kind !== "notfound" ? current.error : null;
        if (!err && !("error" in current) && !current.voided) {
          const done =
            step.op === "void_invoice" ? await voidInvoice(access, current, newRequestId(), fetchImpl) : await deleteSales(access, "Invoice", current, newRequestId(), fetchImpl);
          if ("error" in done) err = done.error;
        }
        if (err) {
          await stopIf(err);
          if (isTransient(err)) return countTransient(err);
          return removalRefused(step.recordType, r, step.op === "void_invoice" ? "void" : "delete", err);
        }
        await save(step.recordType, r.record_id, r.bill_id, { status: "removed", qb_id: null, failed_op: null, reason: null, tried_hash: null, next_try_at: null, tries: 0 });
        qb.delete(`${step.recordType}:${r.record_id}`);
        summary.removed += 1;
        return;
      }

      case "create_payment": {
        const { money: m, invoice, hash, record } = step;
        if (mismatched.has(invoice.id)) return waitOnTotal("customer_payment", m.id, invoice.id, hash);
        const invoiceQbId = qb.get(keyOf(invoice));
        if (!invoiceQbId) {
          await save("customer_payment", m.id, invoice.id, { status: "waiting", reason: SALES_WAIT.billFirst, tried_hash: hash, next_try_at: null });
          summary.waiting += 1;
          return;
        }
        const ref = await refFor(step.leadId, step.contractId);
        if ("wait" in ref) return waitAt("customer_payment", m.id, invoice.id, record, hash, ref.wait);
        if ("error" in ref) return troubleAt("customer_payment", m.id, invoice.id, record, hash, ref.error);
        const method = await methodOrHold(m.method);
        if (!method) return;
        const body = customerPaymentBody(m, { customerId: ref.id, invoiceQbId, methodId: method.id, depositTo: settings.paymentsAccount, txnDay: day(m.paidAt ?? "") || sendFrom });
        const res = await add("customer_payment", m.id, invoice.id, record, { requestId: newRequestId(), body, hash });
        if (refusedAsMissing(res)) await recheckRefs(step);
        // Deleted there (610) or voided there (refused as such): the invoice is left alone from now on.
        if (res && "refused" in res) await recheckInvoice(invoice);
        return;
      }
      case "update_payment": {
        const { money: m, invoice, hash, record } = step;
        const invoiceQbId = qb.get(keyOf(invoice));
        if (!invoiceQbId || mismatched.has(invoice.id)) return;
        const ref = await refFor(step.leadId, step.contractId);
        // Its customer or job can't be used (made inactive in QuickBooks, say): it waits, saying so, still in QuickBooks.
        if ("wait" in ref) return waitAt("customer_payment", m.id, invoice.id, record, hash, ref.wait);
        if ("error" in ref) return troubleAt("customer_payment", m.id, invoice.id, record, hash, ref.error);
        writes += 1;
        const current = await readSales(access, "Payment", record!.qb_id!, fetchImpl);
        if ("error" in current) {
          if (current.error.kind === "notfound") {
            await save("customer_payment", m.id, invoice.id, { status: "gone", reason: "Deleted in QuickBooks, so the CRM doesn't send it again.", tried_hash: hash, next_try_at: null });
            summary.failed += 1;
            return;
          }
          await stopIf(current.error);
          if (isTransient(current.error)) return countTransient(current.error);
          return refusedAt("customer_payment", m.id, invoice.id, record, hash, current.error, "change");
        }
        if (current.voided) {
          await save("customer_payment", m.id, invoice.id, { status: "gone", reason: "Voided in QuickBooks, so the CRM doesn't send it again.", tried_hash: hash, next_try_at: null });
          return;
        }
        if (closedThere(current.txnDate)) return waitAt("customer_payment", m.id, invoice.id, record, hash, SALES_WAIT.closedChange(prefs.bookCloseDate!));
        const method = await methodOrHold(m.method);
        if (!method) return;
        const body = customerPaymentBody(m, { customerId: ref.id, invoiceQbId, methodId: method.id, depositTo: settings.paymentsAccount, txnDay: day(m.paidAt ?? "") || sendFrom });
        // A change leaves out what it doesn't name: a check number taken off is sent empty.
        if (!("PaymentRefNum" in body)) body.PaymentRefNum = "";
        const res = await updateSales(access, "Payment", { ...body, Id: current.id, SyncToken: current.syncToken }, newRequestId(), fetchImpl);
        if (!("error" in res)) {
          await save("customer_payment", m.id, invoice.id, sentNow(res.id, hash));
          summary.changed += 1;
          return;
        }
        await stopIf(res.error);
        if (isTransient(res.error)) return countTransient(res.error);
        // Raised past what's left on its bill there: QuickBooks keeps the old amount, and it says so.
        // (Not when QuickBooks refused it for another reason: in a bank deposit, or books closed -- its own words say so.)
        const raised = current.total !== null && m.amountCents > Math.round(current.total * 100);
        const otherCause = res.error.code === "6540" || res.error.code === "6210" || /closed|deposit/i.test(res.error.message);
        if (raised && res.error.kind === "validation" && !otherCause) await waitAt("customer_payment", m.id, invoice.id, record, hash, SALES_WAIT.raisedPastBill);
        else await refusedAt("customer_payment", m.id, invoice.id, record, hash, res.error, "change");
        // Its invoice deleted or voided there since: left alone from now on.
        await recheckInvoice(invoice);
        return;
      }
      case "void_payment": {
        const r = step.record;
        writes += 1;
        const current = await readSales(access, "Payment", r.qb_id!, fetchImpl);
        let err: QbError | null = "error" in current && current.error.kind !== "notfound" ? current.error : null;
        if (!err && !("error" in current) && !current.voided) {
          const done = await voidCustomerPayment(access, current, newRequestId(), fetchImpl);
          if ("error" in done) err = done.error;
        }
        if (err) {
          // Its invoice isn't voided while the payment is still on it in QuickBooks.
          if (r.bill_id) held.add(r.bill_id);
          await stopIf(err);
          if (isTransient(err)) return countTransient(err);
          return removalRefused("customer_payment", r, "void", err);
        }
        await save("customer_payment", r.record_id, r.bill_id, { status: "removed", qb_id: null, failed_op: null, reason: null, tried_hash: null, next_try_at: null, tries: 0 });
        qb.delete(`customer_payment:${r.record_id}`);
        summary.removed += 1;
        return;
      }

      case "create_credit": {
        const { credit: c, invoice, hash, record } = step;
        if (mismatched.has(invoice.id)) return waitOnTotal("credit", c.id, invoice.id, hash);
        if (!qb.get(keyOf(invoice))) return;
        // A credit memo doesn't name its invoice, so QuickBooks would take it even with the invoice deleted there: look first.
        if (await recheckInvoice(invoice)) return;
        const ref = await refFor(step.leadId, step.contractId);
        if ("wait" in ref) return waitAt("credit", c.id, invoice.id, record, hash, ref.wait);
        if ("error" in ref) return troubleAt("credit", c.id, invoice.id, record, hash, ref.error);
        const body = creditMemoBody(c, { customerId: ref.id, item: items.job, docNumber: step.docNumber, day: day(c.createdAt) || sendFrom, salesTax: prefs.salesTax });
        const res = await add("credit", c.id, invoice.id, record, { requestId: newRequestId(), body, hash });
        if (refusedAsMissing(res)) await recheckRefs(step);
        return;
      }
      case "link_credit": {
        const { credit: c, invoice, hash, record } = step;
        const invoiceQbId = qb.get(keyOf(invoice));
        const creditQbId = qb.get(`credit:${c.id}`);
        if (!invoiceQbId || !creditQbId || mismatched.has(invoice.id)) return;
        const ref = await refFor(step.leadId, step.contractId);
        if ("wait" in ref) return waitAt("credit_link", c.id, invoice.id, record, hash, ref.wait);
        if ("error" in ref) return troubleAt("credit_link", c.id, invoice.id, record, hash, ref.error);
        const body = creditLinkBody({ customerId: ref.id, invoiceQbId, creditQbId, amountCents: c.amountCents, day: day(c.createdAt) || sendFrom });
        const res = await add("credit_link", c.id, invoice.id, record, { requestId: newRequestId(), body, hash });
        if (refusedAsMissing(res)) await recheckRefs(step);
        if (res && "refused" in res) {
          await recheckInvoice(invoice);
          await recheckCreditMemo(c.id, invoice.id);
        }
        return;
      }
      case "remove_credit": {
        writes += 1;
        // The $0.00 payment that applies it first, then the credit memo.
        for (const [type, r] of [
          ["credit_link", step.link],
          ["credit", step.credit],
        ] as const) {
          if (!r) continue;
          const entity: SalesEntity = type === "credit" ? "CreditMemo" : "Payment";
          const current = await readSales(access, entity, r.qb_id!, fetchImpl);
          let err: QbError | null = "error" in current && current.error.kind !== "notfound" ? current.error : null;
          if (!err && !("error" in current)) {
            const done = await deleteSales(access, entity, current, newRequestId(), fetchImpl);
            if ("error" in done && done.error.kind !== "notfound") err = done.error;
          }
          if (err) {
            if (step.invoiceId) held.add(step.invoiceId);
            await stopIf(err);
            if (isTransient(err)) return countTransient(err);
            return removalRefused(type, r, "remove", err);
          }
          await save(type, r.record_id, r.bill_id, { status: "removed", qb_id: null, failed_op: null, reason: null, tried_hash: null, next_try_at: null, tries: 0 });
          qb.delete(`${type}:${r.record_id}`);
        }
        summary.removed += 1;
        return;
      }

      case "create_refund": {
        const { money: m, hash, record } = step;
        if (mismatched.has(step.invoiceId)) return waitOnTotal("refund", m.id, step.invoiceId, hash);
        // Never before its payment: a refund receipt names neither the payment nor its invoice, so QuickBooks would take
        // one whose payment didn't go this run (its invoice refused, or deleted there).
        if (!qb.get(`customer_payment:${m.refundOf}`)) {
          return save("refund", m.id, step.invoiceId, { status: "waiting", reason: SALES_WAIT.paymentFirst, tried_hash: hash, next_try_at: null });
        }
        const accountId =
          step.account === "hand"
            ? settings.handRefundsAccount
            : (settings.stripeRefundsAccount ?? undepositedFundsId(Array.isArray(conn.accounts) ? conn.accounts : []));
        if (!accountId) return waitAt("refund", m.id, step.invoiceId, record, hash, "Pick the account Stripe refunds come out of, in Settings › QuickBooks.");
        const ref = await refFor(step.leadId, step.contractId);
        if ("wait" in ref) return waitAt("refund", m.id, step.invoiceId, record, hash, ref.wait);
        if ("error" in ref) return troubleAt("refund", m.id, step.invoiceId, record, hash, ref.error);
        const method = await methodOrHold(m.method);
        if (!method) return;
        const body = refundReceiptBody(m, { customerId: ref.id, item: items.job, accountId, methodId: method.id, salesTax: prefs.salesTax, txnDay: day(m.paidAt ?? "") || sendFrom });
        const res = await add("refund", m.id, step.invoiceId, record, { requestId: newRequestId(), body, hash });
        if (refusedAsMissing(res)) await recheckRefs(step);
        return;
      }
      case "delete_refund": {
        const r = step.record;
        writes += 1;
        const current = await readSales(access, "RefundReceipt", r.qb_id!, fetchImpl);
        let err: QbError | null = "error" in current && current.error.kind !== "notfound" ? current.error : null;
        if (!err && !("error" in current)) {
          const done = await deleteSales(access, "RefundReceipt", current, newRequestId(), fetchImpl);
          if ("error" in done) err = done.error;
        }
        if (err) {
          await stopIf(err);
          if (isTransient(err)) return countTransient(err);
          return removalRefused("refund", r, "remove", err);
        }
        await save("refund", r.record_id, r.bill_id, { status: "removed", qb_id: null, failed_op: null, reason: null, tried_hash: null, next_try_at: null, tries: 0 });
        summary.removed += 1;
        return;
      }
    }
  };

  for (const step of steps) {
    const writesQuickBooks = step.op !== "drop" && step.op !== "wait" && step.op !== "settle" && step.op !== "unneeded";
    if (writesQuickBooks && (writes >= cap || Date.now() > deadline)) {
      summary.more = true;
      break;
    }
    try {
      await doStep(step);
    } catch (err) {
      if (err instanceof StopRun) {
        summary.error = err.message;
        summary.more = true;
        return;
      }
      throw err;
    }
  }
}
