import { moneyCents, paidTotalCents, phaseOwedCents, type PortalPayment } from "./data/types.ts";

/**
 * What a payment receipt emailed to the customer says (DECISIONS #151):
 * what was paid, for what, when and how, and what is still owed. Pure,
 * so the send path and the tests share it.
 */

/** How a payment method reads on a receipt; null when there's nothing worth saying. */
export function receiptMethodLabel(method: string | null | undefined): string | null {
  switch (method) {
    case "card":
      return "Card";
    case "us_bank_account":
      return "Bank transfer";
    case "check":
      return "Check";
    case "cash":
      return "Cash";
    case "zelle":
      return "Zelle";
    case "wire":
      return "Wire transfer";
    default:
      return null;
  }
}

type FigurePayment = Pick<PortalPayment, "status" | "amount_cents"> & { estimate_payment_id: string | null };

/**
 * The balances a receipt quotes, from the document's payments (this one
 * included): what is still owed on the bill it paid -- null for a
 * deposit, which settles no bill -- and the money in on the document so
 * far. Only money that has arrived counts, as on every money screen.
 */
export function receiptFigures(
  stage: { id: string; amount_cents: number; requested_at: string | null } | null,
  payments: FigurePayment[]
): { stageOwedCents: number | null; paidToDateCents: number } {
  return {
    stageOwedCents: stage
      ? phaseOwedCents(stage, payments.filter((p) => p.estimate_payment_id === stage.id))
      : null,
    paidToDateCents: paidTotalCents(payments),
  };
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const longDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export type ReceiptEmailInput = {
  companyName: string;
  customerName: string | null;
  amountCents: number;
  /** The day the money arrived, YYYY-MM-DD on the company's clock. */
  paidOn: string;
  method: string | null;
  /** A check number or transfer reference. */
  reference: string | null;
  isInvoice: boolean;
  isDeposit: boolean;
  docNumber: string;
  title: string | null;
  /** The stage paid, for a contract or change order. */
  stageName: string | null;
  /** Still owed on the bill this paid; null for a deposit. */
  stageOwedCents: number | null;
  paidToDateCents: number;
  totalCents: number;
};

export function receiptEmail(p: ReceiptEmailInput): { subject: string; text: string; html: string } {
  const amount = moneyCents(p.amountCents);
  const what = p.isInvoice
    ? `invoice ${p.docNumber}`
    : p.isDeposit
      ? `the deposit on ${p.docNumber}`
      : `${p.stageName || "Progress payment"} on ${p.docNumber}`;
  const subject = `${p.companyName}: payment received, ${amount} for ${what}`;
  const opening = `Thank you. We received your payment of ${amount} for ${what}${p.title ? ` (${p.title})` : ""}.`;

  const method = receiptMethodLabel(p.method);
  const reference = p.reference?.trim() || null;
  const details = [
    `Amount: ${amount}`,
    `Date: ${longDay(p.paidOn)}`,
    ...(method ? [`Paid by: ${method}`] : []),
    ...(reference ? [`Reference: ${reference}`] : []),
  ];

  // What is left: on an invoice, the invoice; on a contract, the stage
  // paid (when something is still owed on it) and the contract as a whole.
  const balance: string[] = [];
  if (p.isInvoice) {
    // Money not filed to the invoice's bill says nothing about its balance.
    if (p.stageOwedCents !== null) {
      balance.push(
        p.stageOwedCents
          ? `Still owed on invoice ${p.docNumber}: ${moneyCents(p.stageOwedCents)}.`
          : `Invoice ${p.docNumber} is paid in full.`
      );
    }
  } else {
    if (p.stageOwedCents) balance.push(`Still owed on ${p.stageName || "this payment"}: ${moneyCents(p.stageOwedCents)}.`);
    balance.push(`Paid so far on ${p.docNumber}: ${moneyCents(p.paidToDateCents)} of ${moneyCents(p.totalCents)}.`);
  }

  const greeting = p.customerName?.trim() || "there";
  const closing = "Keep this email for your records. If anything looks wrong, just reply.";

  const text = [
    `Hi ${greeting},`,
    ``,
    opening,
    ``,
    ...details,
    ``,
    ...(balance.length ? [...balance, ``] : []),
    closing,
    ``,
    `Thank you,`,
    p.companyName,
  ].join("\n");

  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px">`,
    `<p>Hi ${escapeHtml(greeting)},</p>`,
    `<p>${escapeHtml(opening)}</p>`,
    `<p style="margin:0"><strong>${escapeHtml(details[0])}</strong></p>`,
    ...details.slice(1).map((line) => `<p style="margin:0">${escapeHtml(line)}</p>`),
    ...(balance.length ? [`<p style="margin:18px 0">${balance.map(escapeHtml).join("<br>")}</p>`] : []),
    `<p style="font-size:13px;color:#666">${escapeHtml(closing)}</p>`,
    `<p>Thank you,<br>${escapeHtml(p.companyName)}</p>`,
    `</div>`,
  ].join("");

  return { subject, text, html };
}
