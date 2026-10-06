import { moneyCents } from "./data/types.ts";

/**
 * What a bill sent by email says, and how a send is recorded
 * (DECISIONS #150). A bill is an invoice, or a billed stage of a
 * contract; either can go out by text, by email, or both. Pure, so the
 * send path and the tests share it.
 */

export type BillChannel = "text" | "email" | "both";
export type SentVia = "text" | "email" | "text+email";

export function billChannelParts(channel: BillChannel): { text: boolean; email: boolean } {
  return { text: channel !== "email", email: channel !== "text" };
}

/** What `estimate_payments.sent_via` records for what actually went out. */
export function sentViaOf(texted: boolean, emailed: boolean): SentVia | null {
  if (texted && emailed) return "text+email";
  if (texted) return "text";
  if (emailed) return "email";
  return null;
}

export function sentViaLabel(via: string | null | undefined): string | null {
  if (via === "text+email") return "by text and email";
  if (via === "email") return "by email";
  if (via === "text") return "by text";
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Who an emailed bill goes to: the customer, with the second contact
 * (a joint owner) copied -- or the second contact alone when the
 * customer has no address. Each address once, whatever its case.
 */
export function billRecipients(primary: string | null | undefined, second: string | null | undefined): { to: string[]; cc: string[] } {
  const clean = (v: string | null | undefined) => {
    const s = (v ?? "").trim().toLowerCase();
    return EMAIL.test(s) ? s : null;
  };
  const a = clean(primary);
  const b = clean(second);
  if (a && b && a !== b) return { to: [a], cc: [b] };
  const one = a ?? b;
  return { to: one ? [one] : [], cc: [] };
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const longDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export type BillEmailInput = {
  companyName: string;
  customerName: string | null;
  /** An invoice is one bill; a contract is billed a stage at a time. */
  isInvoice: boolean;
  docNumber: string;
  title: string | null;
  /** The stage billed, for a contract or change order. */
  stageName: string | null;
  amountCents: number;
  /** YYYY-MM-DD. */
  dueDate: string;
  /** "Net 15", "Due on receipt" -- an invoice's terms, when it has them. */
  termsLabel: string | null;
  link: string;
};

export function billEmail(p: BillEmailInput): { subject: string; text: string; html: string } {
  const amount = moneyCents(p.amountCents);
  const due = longDay(p.dueDate);
  const what = p.isInvoice
    ? `invoice ${p.docNumber}`
    : `${p.stageName || "Progress payment"} on ${p.docNumber}`;
  const subject = p.isInvoice
    ? `${p.companyName}: ${what} for ${amount}, due ${due}`
    : `${p.companyName}: ${what}, ${amount} due ${due}`;
  const opening = p.isInvoice
    ? `Here's invoice ${p.docNumber}${p.title ? ` for ${p.title}` : ""}.`
    : `Payment for ${what}${p.title ? ` (${p.title})` : ""} is now due.`;
  const dueLine = `Due: ${due}${p.termsLabel ? ` (${p.termsLabel})` : ""}`;
  const greeting = p.customerName?.trim() || "there";

  const text = [
    `Hi ${greeting},`,
    ``,
    opening,
    ``,
    `Amount due: ${amount}`,
    dueLine,
    ``,
    `View and pay: ${p.link}`,
    `The link signs you in to your customer page. It expires in 7 days.`,
    ...(p.isInvoice ? [``, `A PDF copy is attached.`] : []),
    ``,
    `Thank you,`,
    p.companyName,
  ].join("\n");

  const e = {
    greeting: escapeHtml(greeting),
    opening: escapeHtml(opening),
    amount: escapeHtml(amount),
    dueLine: escapeHtml(dueLine),
    link: escapeHtml(p.link),
    company: escapeHtml(p.companyName),
  };
  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px">`,
    `<p>Hi ${e.greeting},</p>`,
    `<p>${e.opening}</p>`,
    `<p style="margin:0"><strong>Amount due: ${e.amount}</strong></p>`,
    `<p style="margin:0 0 18px">${e.dueLine}</p>`,
    `<p><a href="${e.link}" style="display:inline-block;background:#c8601f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold">View and pay</a></p>`,
    `<p style="font-size:13px;color:#666">The link signs you in to your customer page. It expires in 7 days.</p>`,
    ...(p.isInvoice ? [`<p style="font-size:13px;color:#666">A PDF copy is attached.</p>`] : []),
    `<p>Thank you,<br>${e.company}</p>`,
    `</div>`,
  ].join("");

  return { subject, text, html };
}
