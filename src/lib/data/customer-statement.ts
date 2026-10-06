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
  /** Removed by hand (0213, DECISIONS #160): not on the statement. */
  removed_at?: string | null;
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

export type CustomerStatement = {
  lines: StatementLine[];
  billedCents: number;
  paidCents: number;
  /** Owed now; below zero is a credit. */
  balanceCents: number;
  /** The part of it past its due date. */
  overdueCents: number;
  /** Payments on their way, not in the balance. */
  clearing: { cents: number; count: number };
};

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
  opts: { today: string; zone: string },
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
  // its full amount, the credit comes off after it. One removed by hand
  // (#160) is left out, as if it was never given.
  for (const c of credits) {
    const label = billLabel.get(c.estimate_payment_id);
    const row = rows.find((r) => r.id === c.estimate_payment_id);
    if (!label || !row || c.amount_cents <= 0 || c.removed_at) continue;
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

  let balance = 0;
  let billed = 0;
  let paid = 0;
  const lines: StatementLine[] = entries.map(({ at, order: _order, ...e }) => {
    if (e.kind === "payment") {
      paid += e.amountCents;
      balance -= e.amountCents;
    } else if (e.kind === "refund") {
      // Money back out: what they've paid comes down, what they owe goes up.
      paid -= e.amountCents;
      balance += e.amountCents;
    } else {
      billed += e.amountCents;
      balance += e.amountCents;
    }
    return { ...e, day: isoDateInZone(new Date(at), opts.zone), balanceCents: balance };
  });

  return { lines, billedCents: billed, paidCents: paid, balanceCents: balance, overdueCents, clearing };
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
  const subject = `${p.companyName}: your statement, ${balanceWords(s.balanceCents)}`;
  const greeting = p.customerName?.trim() || "there";
  const opening = `Here's your statement as of ${longDay(p.today)}.`;
  const balanceLine =
    s.balanceCents < 0
      ? `Credit: ${moneyCents(-s.balanceCents)}`
      : `Balance due: ${moneyCents(s.balanceCents)}${s.overdueCents > 0 ? ` (${moneyCents(s.overdueCents)} past due)` : ""}`;
  const clearingLine = s.clearing.cents > 0 ? `Payments on their way: ${moneyCents(s.clearing.cents)}, not counted until they arrive.` : null;

  const text = [
    `Hi ${greeting},`,
    ``,
    opening,
    ``,
    balanceLine,
    ...(clearingLine ? [clearingLine] : []),
    ``,
    ...s.lines.map((l) => `${longDay(l.day)}  ${l.label}  ${statementAmount(l)}  balance ${moneyCents(l.balanceCents)}`),
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
  const head = `padding:6px 4px;border-bottom:2px solid #ccc;text-align:left;font-size:12px;color:#666`;

  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:640px">`,
    `<p>Hi ${escapeHtml(greeting)},</p>`,
    `<p>${escapeHtml(opening)}</p>`,
    `<p style="margin:0"><strong>${escapeHtml(balanceLine)}</strong></p>`,
    ...(clearingLine ? [`<p style="margin:0;font-size:13px;color:#666">${escapeHtml(clearingLine)}</p>`] : []),
    s.lines.length
      ? `<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:13px"><thead><tr>` +
        `<th style="${head}">Date</th><th style="${head}">Description</th>` +
        `<th style="${head};text-align:right">Amount</th><th style="${head};text-align:right">Balance</th>` +
        `</tr></thead><tbody>${rows}</tbody></table>`
      : `<p>Nothing has been billed yet.</p>`,
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
