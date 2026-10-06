import { paidTotalCents, phaseOwedCents, phaseState, type PortalPayment } from "./types.ts";

/**
 * Everything the company has billed a customer, one row per bill
 * (DECISIONS #148): an invoice, or a billed stage of a contract or a
 * change order. The Invoices page lists these rows and Money to Collect
 * counts the open ones, so the two can never disagree.
 *
 * Built from the same facts every money screen reads -- a stage is billed
 * once `requested_at` is set, and what is owed is its amount less the
 * settled money filed to it -- with the status a person would give it.
 * Pure, so the pages and the tests share it.
 */

export type InvoiceStatus =
  | "draft"
  | "billed"
  | "sent"
  | "viewed"
  | "partial"
  | "overdue"
  | "clearing"
  | "paid"
  | "void"
  | "credit";

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  billed: "Billed",
  sent: "Sent",
  viewed: "Viewed",
  partial: "Part paid",
  overdue: "Overdue",
  clearing: "Payment clearing",
  paid: "Paid",
  void: "Void",
  credit: "Credit",
};

export type InvoiceDocLite = {
  id: string;
  lead_id: string;
  doc_number: string;
  title: string | null;
  kind: string | null;
  status: string;
  signed_at: string | null;
  created_at: string;
  total_cents: number;
};

export type InvoiceStageLite = {
  id: string;
  estimate_id: string;
  sort_order: number;
  name: string | null;
  amount_cents: number;
  requested_at: string | null;
  due_date: string | null;
  cancelled_at: string | null;
};

export type InvoicePaymentLite = Pick<PortalPayment, "status" | "amount_cents" | "paid_at"> & {
  estimate_payment_id: string | null;
};

/** The columns the rows are built from, for the pages' selects. */
export const INVOICE_DOC_COLUMNS = "id, lead_id, doc_number, title, kind, status, signed_at, created_at, total_cents";

/** The documents the rows come from: signed and cancelled ones of every
 *  kind, and draft invoices (a draft estimate or contract is no bill). */
export const INVOICE_DOC_FILTER = "status.in.(Signed,Void),and(kind.eq.invoice,status.eq.Draft)";
export const INVOICE_STAGE_COLUMNS = "id, estimate_id, sort_order, name, amount_cents, requested_at, due_date, cancelled_at";
export const INVOICE_PAYMENT_COLUMNS = "estimate_payment_id, status, amount_cents, paid_at";

export type InvoiceRow = {
  /** The stage's id, or `void-<document id>` for a cancelled invoice and
   *  `draft-<document id>` for one not issued yet. */
  id: string;
  docId: string;
  docNumber: string;
  leadId: string;
  /** An invoice is one bill; a contract or change order is billed a stage at a time. */
  isInvoice: boolean;
  title: string;
  /** The stage billed, or null for an invoice. */
  stage: string | null;
  /** When it was billed; for a draft, when it was started. */
  billedAt: string;
  dueDate: string | null;
  amountCents: number;
  paidCents: number;
  owedCents: number;
  status: InvoiceStatus;
  /** When the customer last opened it since it was billed. */
  viewedAt: string | null;
};

/**
 * The rows for a company's documents, stages and payments.
 *
 * `lastViewByDoc` is each document's most recent opening in the portal;
 * `today` is the company's own YYYY-MM-DD, so "overdue" turns over at the
 * office's midnight, not the server's. `sentByStage` is when each bill
 * was last sent to the customer (DECISIONS #150): a bill billed without
 * a send reads Billed, one sent reads Sent.
 */
export function buildInvoiceRows(
  docs: InvoiceDocLite[],
  stages: InvoiceStageLite[],
  payments: InvoicePaymentLite[],
  lastViewByDoc: Map<string, string>,
  today: string,
  sentByStage: Map<string, string> = new Map()
): InvoiceRow[] {
  const docById = new Map(docs.map((d) => [d.id, d]));
  const paymentsByStage = new Map<string, InvoicePaymentLite[]>();
  for (const p of payments) {
    if (!p.estimate_payment_id) continue;
    const list = paymentsByStage.get(p.estimate_payment_id) ?? [];
    list.push(p);
    paymentsByStage.set(p.estimate_payment_id, list);
  }
  // phaseState compares against the end of the due day on the server's
  // clock; midday of the company's today lands on the right side of it.
  const at = new Date(`${today}T12:00:00`);

  const rows: InvoiceRow[] = [];
  for (const s of stages) {
    const d = docById.get(s.estimate_id);
    if (!d || !s.requested_at || s.cancelled_at) continue;
    const isInvoice = d.kind === "invoice";
    // A cancelled invoice is listed once, from the document, below.
    if (isInvoice && d.status === "Void") continue;
    if (d.status !== "Signed" && d.status !== "Void") continue;

    const paid = paymentsByStage.get(s.id) ?? [];
    const base = {
      id: s.id,
      docId: d.id,
      docNumber: d.doc_number,
      leadId: d.lead_id,
      isInvoice,
      title: d.title || d.doc_number,
      stage: isInvoice ? null : s.name || `Phase ${s.sort_order + 1}`,
      billedAt: s.requested_at,
      dueDate: s.due_date,
      amountCents: s.amount_cents,
      paidCents: paidTotalCents(paid),
    };
    if (d.status === "Void") {
      rows.push({ ...base, owedCents: 0, status: "void", viewedAt: null });
      continue;
    }
    if (s.amount_cents < 0) {
      rows.push({ ...base, owedCents: 0, status: "credit", viewedAt: null });
      continue;
    }
    const lastView = lastViewByDoc.get(d.id) ?? null;
    const viewedAt = lastView && lastView >= s.requested_at ? lastView : null;
    const state = phaseState(s, paid, at);
    const status: InvoiceStatus =
      state === "billed" || state === "unbilled"
        ? viewedAt
          ? "viewed"
          : sentByStage.has(s.id)
            ? "sent"
            : "billed"
        : state;
    rows.push({ ...base, owedCents: phaseOwedCents(s, paid), status, viewedAt });
  }

  for (const d of docs) {
    if (d.kind !== "invoice" || (d.status !== "Void" && d.status !== "Draft")) continue;
    const draft = d.status === "Draft";
    rows.push({
      id: `${draft ? "draft" : "void"}-${d.id}`,
      docId: d.id,
      docNumber: d.doc_number,
      leadId: d.lead_id,
      isInvoice: true,
      title: d.title || d.doc_number,
      stage: null,
      billedAt: draft ? d.created_at : (d.signed_at ?? d.created_at),
      dueDate: null,
      amountCents: d.total_cents,
      paidCents: 0,
      owedCents: 0,
      status: draft ? "draft" : "void",
      viewedAt: null,
    });
  }
  return rows;
}

export const INVOICE_STATUS_GROUPS = ["open", "overdue", "paid", "draft", "void", "all"] as const;
export type InvoiceStatusGroup = (typeof INVOICE_STATUS_GROUPS)[number];

const OPEN: InvoiceStatus[] = ["billed", "sent", "viewed", "partial", "overdue", "clearing"];

/** Whether a row's status belongs to a filter. Open is everything still owed. */
export function inStatusGroup(status: InvoiceStatus, group: InvoiceStatusGroup): boolean {
  if (group === "all") return true;
  if (group === "open") return OPEN.includes(status);
  return status === group;
}

export const INVOICE_PERIODS = ["all", "30", "90", "365"] as const;
export type InvoicePeriod = (typeof INVOICE_PERIODS)[number];

/** Whether a bill went out within the last `period` days (an instant, so no time zone in it). */
export function billedWithin(billedAt: string, period: InvoicePeriod, now: Date = new Date()): boolean {
  if (period === "all") return true;
  return new Date(billedAt).getTime() >= now.getTime() - Number(period) * 86_400_000;
}

export type InvoiceQuery = { status: InvoiceStatusGroup; period: InvoicePeriod };

/** The address's query, kept only where it is what it should be; the default otherwise. */
export function parseInvoiceQuery(p: { status?: unknown; period?: unknown }): InvoiceQuery {
  const status = (INVOICE_STATUS_GROUPS as readonly unknown[]).includes(p.status) ? (p.status as InvoiceStatusGroup) : "open";
  const period = (INVOICE_PERIODS as readonly unknown[]).includes(p.period) ? (p.period as InvoicePeriod) : "all";
  return { status, period };
}

/** The query for the address: "" for the default, else "?…" with only what differs. */
export function invoiceQueryString(q: InvoiceQuery): string {
  const params = new URLSearchParams();
  if (q.status !== "open") params.set("status", q.status);
  if (q.period !== "all") params.set("period", q.period);
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Days past a due date on `today` (both YYYY-MM-DD): negative before it, 0 with none. */
export function daysLate(dueDate: string | null, today: string): number {
  if (!dueDate) return 0;
  const day = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((day(today) - day(dueDate)) / 86_400_000);
}

export type AgingBucket = "not_due" | "late_1_30" | "late_31_90" | "late_90_plus";

/** Where an open bill sits in the ageing: by how late it is, not how old. */
export function agingBucket(dueDate: string | null, today: string): AgingBucket {
  const late = daysLate(dueDate, today);
  if (late <= 0) return "not_due";
  if (late <= 30) return "late_1_30";
  if (late <= 90) return "late_31_90";
  return "late_90_plus";
}

export type InvoiceSummary = {
  outstanding: { cents: number; count: number };
  overdue: { cents: number; count: number };
  billed30: { cents: number; count: number };
  paid30: { cents: number; count: number };
};

/**
 * The page's cards, over every row whatever the filters: what is owed
 * now, how much of it is late, and the last 30 days billed and paid
 * (paid by when the money landed, on bills that still stand).
 */
export function invoiceSummary(rows: InvoiceRow[], payments: InvoicePaymentLite[], now: Date = new Date()): InvoiceSummary {
  const add = (acc: { cents: number; count: number }, cents: number) => {
    acc.cents += cents;
    acc.count += 1;
  };
  const out: InvoiceSummary = {
    outstanding: { cents: 0, count: 0 },
    overdue: { cents: 0, count: 0 },
    billed30: { cents: 0, count: 0 },
    paid30: { cents: 0, count: 0 },
  };
  const standing = new Set<string>();
  for (const r of rows) {
    // A cancelled bill is owed nothing, and a draft hasn't been billed.
    if (r.status === "void" || r.status === "draft") continue;
    standing.add(r.id);
    if (inStatusGroup(r.status, "open")) add(out.outstanding, r.owedCents);
    if (r.status === "overdue") add(out.overdue, r.owedCents);
    if (r.status !== "credit" && billedWithin(r.billedAt, "30", now)) add(out.billed30, r.amountCents);
  }
  for (const p of payments) {
    if (p.status !== "succeeded" || !p.paid_at || !p.estimate_payment_id || !standing.has(p.estimate_payment_id)) continue;
    if (billedWithin(p.paid_at, "30", now)) add(out.paid30, p.amount_cents);
  }
  return out;
}
