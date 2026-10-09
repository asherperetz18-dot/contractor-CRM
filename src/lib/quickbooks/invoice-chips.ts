import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { companyIanaZone } from "@/lib/data/types";
import { isoDateInZone } from "@/lib/company-clock";
import { qbWebUrl, type ChipRecord, type QbChip } from "./bill-status";
import { creditChipRecord, invoiceQbChips } from "./invoice-status";

/**
 * Where each bill to a customer stands with QuickBooks (DECISIONS #184),
 * for the Invoices page and a contract's payment schedule. The connection
 * is server-only and the records are read here, after the page's own gate
 * (View Financials), with the server's client.
 */

export type QbLine = { chips: QbChip[]; url: string | null };

type Admin = ReturnType<typeof createAdminClient>;
const IN_CHUNK = 100;
const RECORD_COLUMNS = "record_type, record_id, bill_id, qb_id, status, failed_op, reason, sent_at";

/** Rows for many ids, a chunk at a time and page by page (several rows per id: a stage's payments). */
async function chunks<T>(ids: string[], read: (chunk: string[], from: number, to: number) => PromiseLike<{ data: unknown }>): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const chunk = unique.slice(i, i + IN_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const rows = ((await read(chunk, from, from + PAGE - 1)).data as T[] | null) ?? [];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/** Taken off in the CRM, but QuickBooks wouldn't let it go: shown on its bill. */
const stuckOn = (records: ChipRecord[], billId: string) =>
  records.filter(
    (r) => r.bill_id === billId && r.record_type !== "invoice" && r.record_type !== "deposit" && r.status === "failed" && r.failed_op === "remove"
  );

type Context = {
  admin: Admin;
  realmId: string;
  environment: "sandbox" | "production";
  sending: boolean;
  sendFrom: string | null;
  sendOutside: boolean;
  zone: string;
};

async function context(companyId: string): Promise<Context | null> {
  const admin = createAdminClient();
  const { data: conn, error } = await admin
    .from("quickbooks_connections")
    .select("realm_id, environment, disconnected_at, send_invoices, send_invoices_from, send_outside_crm")
    .eq("company_id", companyId)
    .maybeSingle<{
      realm_id: string | null;
      environment: "sandbox" | "production";
      disconnected_at: string | null;
      send_invoices: boolean;
      send_invoices_from: string | null;
      send_outside_crm: boolean;
    }>();
  // Never connected, or before 0227: nothing to show.
  if (error || !conn?.realm_id) return null;
  const { data: profile } = await admin.from("company_profile").select("timezone").eq("company_id", companyId).maybeSingle<{ timezone: string | null }>();
  return {
    admin,
    realmId: conn.realm_id,
    environment: conn.environment,
    sending: conn.send_invoices && !conn.disconnected_at,
    sendFrom: conn.send_invoices_from,
    sendOutside: !!conn.send_outside_crm,
    zone: companyIanaZone(profile?.timezone),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayFns(zone: string) {
  const local = (iso: string) => (iso ? isoDateInZone(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso), zone) : "");
  const short = (iso: string) => {
    const d = iso.length === 10 ? iso : local(iso);
    const [, m, dd] = d.split("-").map(Number);
    return m && dd ? `${MONTHS[m - 1]} ${dd}` : d;
  };
  return { local, short };
}

type Money = {
  id: string;
  estimate_payment_id: string | null;
  estimate_id: string;
  amount_cents: number;
  status: string;
  refund_of: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
};
type Credit = { id: string; estimate_payment_id: string | null; removed_at: string | null; refund_payment_id: string | null };

/** What goes to QuickBooks on a bill: its payments (arrived or clearing), credits given by hand, and refunds. */
function sortChildren(money: Money[], credits: Credit[]) {
  const payments = money.filter(
    (m) => !m.refund_of && m.amount_cents > 0 && (m.status === "succeeded" || (m.status === "pending" && !(m.stripe_session_id && !m.stripe_payment_intent_id)))
  );
  const refunds = money.filter((m) => !!m.refund_of && m.amount_cents < 0 && m.status === "succeeded");
  const given = credits.filter((c) => !c.removed_at && !c.refund_payment_id);
  return { payments, refunds, given };
}

/** The QuickBooks line for each Invoices-page row, by row id. */
export async function invoiceRowsQuickBooks(
  companyId: string,
  rows: { id: string; docId: string; leadId: string; status: string; billedAt: string }[]
): Promise<Map<string, QbLine>> {
  const out = new Map<string, QbLine>();
  const ctx = await context(companyId);
  if (!ctx) return out;
  const { admin } = ctx;
  const records: ChipRecord[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("quickbooks_sync")
      .select(RECORD_COLUMNS)
      .eq("company_id", companyId)
      .eq("realm_id", ctx.realmId)
      .in("record_type", ["invoice", "customer_payment", "credit", "credit_link", "refund"])
      .order("record_type")
      .order("record_id")
      .range(from, from + 999);
    if (error) return out;
    records.push(...((data as ChipRecord[] | null) ?? []));
    if (!data || data.length < 1000) break;
  }
  if (!ctx.sending && !records.length) return out;
  const recordOf = new Map(records.map((r) => [`${r.record_type}:${r.record_id}`, r]));

  // A billed stage below zero (status credit) shows too: it waits, saying why.
  const shown = rows.filter((r) => r.status !== "draft");
  // A cancelled invoice's row is its document; its one stage holds the record.
  const voidDocs = shown.filter((r) => r.id.startsWith("void-")).map((r) => r.docId);
  const voidStages = await chunks<{ id: string; estimate_id: string }>(voidDocs, (chunk, from, to) =>
    admin.from("estimate_payments").select("id, estimate_id").eq("company_id", companyId).in("estimate_id", chunk).order("id").range(from, to)
  );
  const stageOfVoid = new Map(voidStages.map((s) => [s.estimate_id, s.id]));
  const stageId = (r: (typeof shown)[number]) => (r.id.startsWith("void-") ? stageOfVoid.get(r.docId) ?? "" : r.id);
  const stageIds = shown.map(stageId).filter(Boolean);

  const [money, credits, leads] = await Promise.all([
    chunks<Money>(stageIds, (chunk, from, to) =>
      admin
        .from("portal_payments")
        .select("id, estimate_payment_id, estimate_id, amount_cents, status, refund_of, stripe_session_id, stripe_payment_intent_id")
        .eq("company_id", companyId)
        .in("estimate_payment_id", chunk)
        .order("id")
        .range(from, to)
    ),
    chunks<Credit>(stageIds, (chunk, from, to) =>
      admin
        .from("bill_credits")
        .select("id, estimate_payment_id, removed_at, refund_payment_id")
        .eq("company_id", companyId)
        .in("estimate_payment_id", chunk)
        .order("id")
        .range(from, to)
    ),
    chunks<{ id: string; portal_payments_disabled: boolean | null }>(
      shown.map((r) => r.leadId),
      (chunk, from, to) => admin.from("leads").select("id, portal_payments_disabled").eq("company_id", companyId).in("id", chunk).order("id").range(from, to)
    ),
  ]);
  const outsideLead = new Set(leads.filter((l) => l.portal_payments_disabled).map((l) => l.id));
  const { local, short } = dayFns(ctx.zone);
  const { payments, refunds, given } = sortChildren(money, credits);
  const on = <T extends { estimate_payment_id: string | null }>(list: T[], id: string) => list.filter((x) => x.estimate_payment_id === id);
  const rec = (type: string, id: string) => recordOf.get(`${type}:${id}`) ?? null;

  for (const r of shown) {
    const sid = stageId(r);
    if (!sid) continue;
    const { chips, qbId } = invoiceQbChips({
      sending: ctx.sending,
      sendFrom: ctx.sendFrom,
      label: "Invoice",
      invoice: { day: local(r.billedAt), voided: r.status === "void", outside: outsideLead.has(r.leadId) && !ctx.sendOutside },
      record: rec("invoice", sid),
      payments: on(payments, sid).map((m) => rec("customer_payment", m.id)),
      credits: on(given, sid).map((c) => creditChipRecord(rec("credit", c.id), rec("credit_link", c.id))),
      refunds: on(refunds, sid).map((m) => rec("refund", m.id)),
      stuck: stuckOn(records, sid),
      day: short,
    });
    if (chips.length) out.set(r.id, { chips, url: qbId ? qbWebUrl(ctx.environment, "invoice", qbId, ctx.realmId) : null });
  }
  return out;
}

/** The QuickBooks line for a signed contract's deposit, on its payment schedule. */
export async function depositQuickBooks(
  companyId: string,
  doc: { id: string; lead_id: string; status: string; signed_at: string | null }
): Promise<QbLine | null> {
  const ctx = await context(companyId);
  if (!ctx) return null;
  const { admin } = ctx;
  const { data: recs } = await admin
    .from("quickbooks_sync")
    .select(RECORD_COLUMNS)
    .eq("company_id", companyId)
    .eq("realm_id", ctx.realmId)
    .eq("record_type", "deposit")
    .eq("record_id", doc.id);
  const record = ((recs as ChipRecord[] | null) ?? [])[0] ?? null;
  if (!ctx.sending && !record) return null;
  const [{ data: moneyRows }, { data: lead }] = await Promise.all([
    admin
      .from("portal_payments")
      .select("id, estimate_payment_id, estimate_id, amount_cents, status, refund_of, stripe_session_id, stripe_payment_intent_id")
      .eq("company_id", companyId)
      .eq("estimate_id", doc.id)
      .is("estimate_payment_id", null),
    admin.from("leads").select("portal_payments_disabled").eq("company_id", companyId).eq("id", doc.lead_id).maybeSingle<{ portal_payments_disabled: boolean | null }>(),
  ]);
  const { payments, refunds } = sortChildren((moneyRows as Money[] | null) ?? [], []);
  const ids = [...payments, ...refunds].map((m) => m.id);
  const { data: childRecs } = ids.length
    ? await admin
        .from("quickbooks_sync")
        .select(RECORD_COLUMNS)
        .eq("company_id", companyId)
        .eq("realm_id", ctx.realmId)
        .in("record_type", ["customer_payment", "refund"])
        .in("record_id", ids)
    : { data: [] };
  const childOf = new Map(((childRecs as ChipRecord[] | null) ?? []).map((r) => [`${r.record_type}:${r.record_id}`, r]));
  const { data: stuckRecs } = await admin
    .from("quickbooks_sync")
    .select(RECORD_COLUMNS)
    .eq("company_id", companyId)
    .eq("realm_id", ctx.realmId)
    .eq("bill_id", doc.id)
    .in("record_type", ["customer_payment", "refund"])
    .eq("status", "failed")
    .eq("failed_op", "remove");
  const { local, short } = dayFns(ctx.zone);
  const { chips, qbId } = invoiceQbChips({
    sending: ctx.sending,
    sendFrom: ctx.sendFrom,
    label: "Deposit invoice",
    invoice: { day: local(doc.signed_at ?? ""), voided: doc.status === "Void", outside: !!lead?.portal_payments_disabled && !ctx.sendOutside },
    record,
    payments: payments.map((m) => childOf.get(`customer_payment:${m.id}`) ?? null),
    credits: [],
    refunds: refunds.map((m) => childOf.get(`refund:${m.id}`) ?? null),
    stuck: (stuckRecs as ChipRecord[] | null) ?? [],
    day: short,
  });
  return chips.length ? { chips, url: qbId ? qbWebUrl(ctx.environment, "invoice", qbId, ctx.realmId) : null } : null;
}
