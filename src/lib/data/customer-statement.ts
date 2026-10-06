import { isUnfinishedCheckout, moneyCents, type PortalPayment } from "./types.ts";
import {
  INVOICE_STATUS_LABEL,
  buildInvoiceRows,
  type InvoiceDocLite,
  type InvoicePaymentLite,
  type InvoiceStageLite,
} from "./invoice-rows.ts";
import { isoDateInZone } from "../company-clock.ts";
import { receiptMethodLabel } from "../receipt-email.ts";

/**
 * One customer's statement (DECISIONS #153): every bill and every
 * payment, in date order, with the balance after each, and what is owed
 * now. Pure, so the page, the email and the tests share it.
 *
 * The bills are the Invoices page's rows (#148) for this customer --
 * billed contract stages and invoices, credits lowering the balance;
 * never a cancelled bill, a draft or a stage not billed yet -- plus each
 * signed contract's deposit, which is due at signing and never a billed
 * stage. Payments are the money that has arrived. Money on its way
 * (a bank transfer clearing, a check not yet banked) is listed apart and
 * left out of the balance until it lands; a checkout opened and left is
 * no payment at all.
 *
 * It can cover a period (DECISIONS #159): what came before its first day
 * is one opening balance, what came after its last day isn't on it, and
 * it ends on that day's balance. What's owed today is kept apart.
 */

export type StatementDoc = InvoiceDocLite & { deposit_cents: number | null };

export type StatementPayment = InvoicePaymentLite &
  Pick<PortalPayment, "kind" | "method" | "created_at"> & {
    estimate_id: string;
    reference: string | null;
    stripe_session_id?: string | null;
    stripe_payment_intent_id?: string | null;
    id?: string;
    /** On a refund, why (DECISIONS #155) -- shown to the customer. A
     *  payment's own note is the office's and never is. */
    note?: string | null;
  };

/** A credit on one of the customer's bills (0209, DECISIONS #154). */
export type StatementCredit = {
  estimate_payment_id: string;
  amount_cents: number;
  reason: string | null;
  created_at: string;
};

export type StatementLine = {
  /** The company's YYYY-MM-DD. */
  day: string;
  /** A refund (DECISIONS #155) is money back to them: it puts the balance up. */
  kind: "charge" | "credit" | "payment" | "refund";
  label: string;
  detail: string;
  docId: string;
  docNumber: string;
  /** Positive for a charge, a payment or a refund; negative for a credit. */
  amountCents: number;
  /** What is owed after this line. */
  balanceCents: number;
};

/** Company YYYY-MM-DD days, both counted. No from is since the start;
 *  no to is up to today. */
export type StatementPeriod = { from: string | null; to: string | null };

export type CustomerStatement = {
  period: StatementPeriod;
  /** Owed before the period's first day; null when it starts at the start. */
  openingCents: number | null;
  /** The period's lines. */
  lines: StatementLine[];
  /** Billed and paid in the period. */
  billedCents: number;
  paidCents: number;
  /** Owed at the end of the period; below zero is a credit. */
  balanceCents: number;
  /** Owed today, whatever the period. */
  todayCents: number;
  /** The part owed today that is past its due date. */
  overdueCents: number;
  /** Payments on their way today, not in any balance. */
  clearing: { cents: number; count: number };
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY.test(v)) return false;
  // Feb 30 rolls over to Mar 2; Sep 45 is no day at all.
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * The period someone asked for, from a page address or a button: days
 * that aren't real are dropped, today or later means up to today, and
 * one given backwards is turned round.
 */
export function statementPeriod(asked: { from?: unknown; to?: unknown }, today: string): StatementPeriod {
  let from = isDay(asked.from) ? asked.from : null;
  let to = isDay(asked.to) && asked.to < today ? asked.to : null;
  if (from && from > today) from = today;
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
}

const longDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function paidBy(p: StatementPayment): string {
  const method = receiptMethodLabel(p.method);
  const ref = p.reference?.trim();
  if (!ref) return method ?? "";
  if (method === "Check") return `Check #${ref}`;
  return `${method ?? "Payment"} · ref ${ref}`;
}

export function buildStatement(
  docs: StatementDoc[],
  stages: InvoiceStageLite[],
  payments: StatementPayment[],
  opts: { today: string; zone: string } & Partial<StatementPeriod>,
  credits: StatementCredit[] = []
): CustomerStatement {
  const docById = new Map(docs.map((d) => [d.id, d]));
  const live = payments.filter(
    (p) =>
      docById.has(p.estimate_id) &&
      !isUnfinishedCheckout({
        status: p.status,
        stripe_session_id: p.stripe_session_id ?? null,
        stripe_payment_intent_id: p.stripe_payment_intent_id ?? null,
      })
  );
  const rows = buildInvoiceRows(docs, stages, live, new Map(), opts.today);

  type Entry = Omit<StatementLine, "day" | "balanceCents"> & { at: string; order: number };
  const entries: Entry[] = [];
  const billLabel = new Map<string, string>();
  const depositLabel = new Map<string, string>();
  let overdueCents = 0;

  for (const r of rows) {
    if (r.status === "void" || r.status === "draft") continue;
    const label = r.isInvoice ? `Invoice ${r.docNumber}` : `${r.stage} — ${r.docNumber}`;
    billLabel.set(r.id, label);
    const title = docById.get(r.docId)?.title || null;
    if (r.status === "credit") {
      entries.push({ at: r.billedAt, order: 0, kind: "credit", label: `Credit: ${label}`, detail: title ?? "", docId: r.docId, docNumber: r.docNumber, amountCents: r.amountCents });
      continue;
    }
    if (r.status === "overdue") overdueCents += r.owedCents;
    const detail = [title, r.dueDate ? `due ${longDay(r.dueDate)}` : null, INVOICE_STATUS_LABEL[r.status]].filter(Boolean).join(" · ");
    entries.push({ at: r.billedAt, order: 0, kind: "charge", label, detail, docId: r.docId, docNumber: r.docNumber, amountCents: r.amountCents });
  }

  for (const d of docs) {
    if (d.status !== "Signed" || d.kind === "invoice" || !d.deposit_cents || d.deposit_cents <= 0) continue;
    const label = `Deposit — ${d.doc_number}`;
    depositLabel.set(d.id, label);
    entries.push({
      at: d.signed_at ?? d.created_at,
      order: 0,
      kind: "charge",
      label,
      detail: [d.title, "due at signing"].filter(Boolean).join(" · "),
      docId: d.id,
      docNumber: d.doc_number,
      amountCents: d.deposit_cents,
    });
  }

  const clearing = { cents: 0, count: 0 };
  for (const p of live) {
    if (p.status === "pending") {
      // Money on its way in. A refund still going through isn't on the
      // statement until it has (DECISIONS #155).
      if (p.amount_cents > 0) {
        clearing.cents += p.amount_cents;
        clearing.count += 1;
      }
      continue;
    }
    if (p.status !== "succeeded") continue;
    const d = docById.get(p.estimate_id)!;
    const forWhat =
      (p.estimate_payment_id ? billLabel.get(p.estimate_payment_id) : depositLabel.get(p.estimate_id)) ??
      (p.estimate_payment_id ? d.doc_number : `Deposit — ${d.doc_number}`);
    const refund = p.amount_cents < 0;
    entries.push({
      at: p.paid_at ?? p.created_at,
      order: 1,
      kind: refund ? "refund" : "payment",
      label: `${refund ? "Refund" : "Payment"} — ${forWhat}`,
      detail: refund ? [paidBy(p), p.note?.trim()].filter(Boolean).join(" · ") : paidBy(p),
      docId: d.id,
      docNumber: d.doc_number,
      amountCents: Math.abs(p.amount_cents),
    });
  }

  // Credits on the bills still on it (DECISIONS #154): the bill keeps
  // its full amount, the credit comes off after it.
  for (const c of credits) {
    const label = billLabel.get(c.estimate_payment_id);
    const row = rows.find((r) => r.id === c.estimate_payment_id);
    if (!label || !row || c.amount_cents <= 0) continue;
    entries.push({
      at: c.created_at,
      order: 1,
      kind: "credit",
      label: `Credit — ${label}`,
      detail: c.reason?.trim() || "",
      docId: row.docId,
      docNumber: row.docNumber,
      amountCents: -c.amount_cents,
    });
  }

  // Oldest first; on the same moment, the bill before the money for it.
  entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.order - b.order);

  const period: StatementPeriod = { from: opts.from ?? null, to: opts.to ?? null };
  let balance = 0;
  let billed = 0;
  let paid = 0;
  let opening = 0;
  let closing = 0;
  const lines: StatementLine[] = [];
  for (const { at, order: _order, ...e } of entries) {
    // Money in brings the balance down; a refund is money back out.
    const change = e.kind === "payment" ? -e.amountCents : e.amountCents;
    balance += change;
    const day = isoDateInZone(new Date(at), opts.zone);
    if (period.from && day < period.from) opening = balance;
    if (period.to && day > period.to) continue;
    closing = balance;
    if (period.from && day < period.from) continue;
    if (e.kind === "payment") paid += e.amountCents;
    else if (e.kind === "refund") paid -= e.amountCents;
    else billed += e.amountCents;
    lines.push({ ...e, day, balanceCents: balance });
  }

  return {
    period,
    openingCents: period.from ? opening : null,
    lines,
    billedCents: billed,
    paidCents: paid,
    balanceCents: closing,
    todayCents: balance,
    overdueCents,
    clearing,
  };
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** A line's amount as the customer reads it: money in shows as minus. */
export function statementAmount(line: Pick<StatementLine, "kind" | "amountCents">): string {
  if (line.kind === "payment") return `-${moneyCents(line.amountCents)}`;
  if (line.amountCents < 0) return `-${moneyCents(-line.amountCents)}`;
  return moneyCents(line.amountCents);
}

/** "$12,450.00 due", "nothing due" or "$200.00 in credit". */
export function balanceWords(cents: number): string {
  if (cents > 0) return `${moneyCents(cents)} due`;
  if (cents < 0) return `${moneyCents(-cents)} in credit`;
  return "nothing due";
}

/** Which days it covers, as the customer reads it: "as of Oct 6, 2026",
 *  "for Sep 1, 2026 – Oct 6, 2026" or "up to Sep 20, 2026". */
export function periodWords(period: StatementPeriod, today: string): string {
  if (period.from) return `for ${longDay(period.from)} – ${longDay(period.to ?? today)}`;
  if (period.to) return `up to ${longDay(period.to)}`;
  return `as of ${longDay(today)}`;
}

/** "Balance on Sep 20, 2026: $4,450.00", or "Credit on …" below zero. */
export function balanceOnWords(cents: number, day: string): string {
  return `${cents < 0 ? "Credit" : "Balance"} on ${longDay(day)}: ${moneyCents(Math.abs(cents))}`;
}

export function statementEmail(p: {
  companyName: string;
  customerName: string | null;
  /** The company's YYYY-MM-DD. */
  today: string;
  statement: CustomerStatement;
  /** The signed View and pay link; null when nothing is owed or they pay outside the CRM. */
  link: string | null;
}): { subject: string; text: string; html: string } {
  const s = p.statement;
  const { from, to } = s.period;
  const words = periodWords(s.period, p.today);
  // A period that has ended closes on its own balance, which isn't what's
  // owed now: that's said apart, and the subject doesn't call it due.
  const subject =
    `${p.companyName}: your statement${from || to ? ` ${words}` : ""}` + (to ? "" : `, ${balanceWords(s.todayCents)}`);
  const greeting = p.customerName?.trim() || "there";
  const opening = `Here's your statement ${words}.`;
  const pastDue = s.overdueCents > 0 ? ` (${moneyCents(s.overdueCents)} past due)` : "";
  const balanceLine = to
    ? balanceOnWords(s.balanceCents, to)
    : s.balanceCents < 0
      ? `Credit: ${moneyCents(-s.balanceCents)}`
      : `Balance due: ${moneyCents(s.balanceCents)}${pastDue}`;
  const todayLine = to ? `Today: ${balanceWords(s.todayCents)}${pastDue}` : null;
  const clearingLine =
    !to && s.clearing.cents > 0 ? `Payments on their way: ${moneyCents(s.clearing.cents)}, not counted until they arrive.` : null;
  const quiet = (from || to) && !s.lines.length ? "Nothing was billed or paid in this period." : null;

  const text = [
    `Hi ${greeting},`,
    ``,
    opening,
    ``,
    balanceLine,
    ...(todayLine ? [todayLine] : []),
    ...(clearingLine ? [clearingLine] : []),
    ``,
    ...(from && s.openingCents !== null ? [`${longDay(from)}  Opening balance  balance ${moneyCents(s.openingCents)}`] : []),
    ...s.lines.map((l) => `${longDay(l.day)}  ${l.label}  ${statementAmount(l)}  balance ${moneyCents(l.balanceCents)}`),
    ...(quiet ? [quiet] : []),
    ...(p.link ? [``, `View and pay: ${p.link}`, `The link signs you in to your customer page. It expires in 7 days.`] : []),
    ``,
    `Questions? Just reply to this email.`,
    ``,
    `Thank you,`,
    p.companyName,
  ].join("\n");

  // Tight cells and a date that may wrap, so four columns fit a phone.
  const cell = "padding:6px 4px;border-bottom:1px solid #eee;vertical-align:top";
  const num = `${cell};text-align:right;white-space:nowrap`;
  const rows = s.lines
    .map(
      (l) =>
        `<tr><td style="${cell};font-size:13px">${escapeHtml(longDay(l.day))}</td>` +
        `<td style="${cell}">${escapeHtml(l.label)}${l.detail ? `<br><span style="font-size:12px;color:#666">${escapeHtml(l.detail)}</span>` : ""}</td>` +
        `<td style="${num}">${escapeHtml(statementAmount(l))}</td>` +
        `<td style="${num}">${escapeHtml(moneyCents(l.balanceCents))}</td></tr>`
    )
    .join("");
  const openingRow =
    from && s.openingCents !== null
      ? `<tr><td style="${cell};font-size:13px">${escapeHtml(longDay(from))}</td>` +
        `<td style="${cell}"><em>Opening balance</em></td><td style="${num}"></td>` +
        `<td style="${num}">${escapeHtml(moneyCents(s.openingCents))}</td></tr>`
      : "";
  const head = `padding:6px 4px;border-bottom:2px solid #ccc;text-align:left;font-size:12px;color:#666`;

  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:640px">`,
    `<p>Hi ${escapeHtml(greeting)},</p>`,
    `<p>${escapeHtml(opening)}</p>`,
    `<p style="margin:0"><strong>${escapeHtml(balanceLine)}</strong></p>`,
    ...(todayLine ? [`<p style="margin:0">${escapeHtml(todayLine)}</p>`] : []),
    ...(clearingLine ? [`<p style="margin:0;font-size:13px;color:#666">${escapeHtml(clearingLine)}</p>`] : []),
    s.lines.length || openingRow
      ? `<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:13px"><thead><tr>` +
        `<th style="${head}">Date</th><th style="${head}">Description</th>` +
        `<th style="${head};text-align:right">Amount</th><th style="${head};text-align:right">Balance</th>` +
        `</tr></thead><tbody>${openingRow}${rows}</tbody></table>`
      : "",
    ...(quiet ? [`<p>${escapeHtml(quiet)}</p>`] : !s.lines.length && !openingRow ? [`<p>Nothing has been billed yet.</p>`] : []),
    ...(p.link
      ? [
          `<p><a href="${escapeHtml(p.link)}" style="display:inline-block;background:#c8601f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold">View and pay</a></p>`,
          `<p style="font-size:13px;color:#666">The link signs you in to your customer page. It expires in 7 days.</p>`,
        ]
      : []),
    `<p style="font-size:13px;color:#666">Questions? Just reply to this email.</p>`,
    `<p>Thank you,<br>${escapeHtml(p.companyName)}</p>`,
    `</div>`,
  ].join("");

  return { subject, text, html };
}
