import { moneyCents } from "./data/types.ts";
import { splitFundedLoan, type LoanPayment, type LoanStage } from "./financing.ts";

/**
 * Switching a signed contract to financing (DECISIONS #166).
 *
 * A customer who signed to pay the contractor directly can pay the rest
 * through the company's lender instead. The office sends a one-page
 * payment change; the customer signs it on their customer page. The
 * contract and its price stay as signed. While the change is signed, the
 * contract's unpaid payments read "Financing": nothing bills or reminds
 * the customer for them, and the lender's payout settles them (#163).
 * "Back to the original schedule" ends it, and billing picks up where it
 * was -- no stage is ever changed by the switch.
 *
 * Pure: the figures, the words, and the signature check.
 */

export type PaymentChangeStatus = "sent" | "signed" | "cancelled" | "reverted";

/** One row of contract_payment_changes (0217). */
export type PaymentChangeRow = {
  id: string;
  estimate_id: string;
  status: PaymentChangeStatus;
  lender: string;
  total_cents: number;
  paid_cents: number;
  finance_cents: number;
  signed_name: string | null;
  signed_at: string | null;
  created_at: string;
  ended_at: string | null;
};

/** The change waiting for a signature or in force, if there is one. */
export function openPaymentChange<T extends { status: string }>(rows: T[]): T | null {
  return rows.find((r) => r.status === "sent" || r.status === "signed") ?? null;
}

export type PaymentChangeLine = {
  label: string;
  /** What the schedule says it is. */
  cents: number;
  /** What's still to pay on it: what the lender would pay. */
  owedCents: number;
  /** Paid (or credited) in full, billed and owed, or not billed yet. */
  state: "paid" | "billed" | "open";
};

/**
 * What the customer is asked to sign: the total on the schedule, what's
 * been paid, and what's left -- the amount to finance. "What's left" is
 * exactly what a funded loan would settle (`splitFundedLoan`): the
 * deposit and each stage, less credits, money settled and money on its
 * way; never a cancelled stage, and a checkout opened and left is nothing.
 */
export function paymentChangeFigures(input: {
  depositDueCents: number;
  stages: (LoanStage & { requested_at?: string | null })[];
  payments: LoanPayment[];
}): { totalCents: number; creditCents: number; paidCents: number; financeCents: number; rows: PaymentChangeLine[] } {
  const live = input.stages.filter((s) => !s.cancelled_at).sort((a, b) => a.sort_order - b.sort_order);
  const loan = { depositDueCents: input.depositDueCents, stages: live, payments: input.payments };
  // A payout of exactly what's open, read back line by line.
  const { openCents } = splitFundedLoan({ ...loan, amountCents: 0 });
  const { parts } = splitFundedLoan({ ...loan, amountCents: openCents });
  const owedOn = (phaseId: string | null) => parts.find((p) => p.phaseId === phaseId)?.cents ?? 0;

  const rows: PaymentChangeLine[] = [];
  if (input.depositDueCents > 0) {
    const owed = owedOn(null);
    rows.push({ label: "Deposit", cents: input.depositDueCents, owedCents: owed, state: owed > 0 ? "open" : "paid" });
  }
  for (const s of live) {
    const owed = owedOn(s.id);
    rows.push({
      label: s.name || "Stage",
      cents: s.amount_cents,
      owedCents: owed,
      state: owed <= 0 ? "paid" : s.requested_at ? "billed" : "open",
    });
  }

  const totalCents = Math.max(0, input.depositDueCents + live.reduce((sum, s) => sum + s.amount_cents, 0));
  const creditCents = live.reduce((sum, s) => sum + Math.max(0, s.credit_cents ?? 0), 0);
  const financeCents = openCents;
  return {
    totalCents,
    creditCents,
    paidCents: Math.max(0, totalCents - creditCents - financeCents),
    financeCents,
    rows,
  };
}

const squash = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The name typed to sign. It must be the name the contract was signed in
 * (as the contract's own typed signature must), ignoring case and extra
 * spaces. With no name on file -- a contract signed on paper -- any full
 * name of two letters or more.
 */
export function signedNameMatches(typed: string, expected: string | null): boolean {
  const t = squash(typed);
  if (t.length < 2 || t.length > 120) return false;
  return expected ? t === squash(expected) : true;
}

/** The text asking the customer to sign. A plain hyphen: an em dash
 *  re-encodes the whole text and shrinks each part from 160 characters
 *  to 70. */
export function paymentChangeSms(p: {
  companyName: string;
  docNumber: string;
  lender: string;
  financeCents: number;
  link: string;
  /** The lender's application link, when the office ticked it. */
  applyUrl?: string | null;
}): string {
  const ask = `${p.companyName}: please review and sign a payment change for ${p.docNumber} - the rest, ${moneyCents(p.financeCents)}, to be paid through ${p.lender} instead of to us directly:\n${p.link}`;
  return p.applyUrl ? `${ask}\n\nApply with ${p.lender} here:\n${p.applyUrl}` : ask;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** The email asking the customer to sign, with the same words as the
 *  customer page. No rate or monthly payment: only the lender states
 *  those, with its disclosures. */
export function paymentChangeEmail(p: {
  companyName: string;
  customerName: string | null;
  docNumber: string;
  lender: string;
  financeCents: number;
  link: string;
  applyUrl?: string | null;
}): { subject: string; html: string; text: string } {
  const subject = `Payment change to sign for ${p.docNumber}`;
  const hello = p.customerName ? `Hi ${p.customerName},` : "Hello,";
  const lines = [
    `You asked to pay the rest of ${p.docNumber} through ${p.lender} instead of paying ${p.companyName} directly. The work and the price stay the same.`,
    `To be paid through ${p.lender}: ${moneyCents(p.financeCents)}.`,
    `${p.lender} decides on your application and sets its terms. If it isn't approved, the original payment schedule applies.`,
  ];
  const text = [
    hello,
    "",
    ...lines,
    "",
    `Review and sign the payment change: ${p.link}`,
    ...(p.applyUrl ? ["", `Apply with ${p.lender}: ${p.applyUrl}`] : []),
    "",
    p.companyName,
  ].join("\n");
  const html = [
    `<p>${escapeHtml(hello)}</p>`,
    ...lines.map((l) => `<p>${escapeHtml(l)}</p>`),
    `<p><a href="${escapeHtml(p.link)}" style="display:inline-block;padding:10px 18px;background:#c7691b;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Review and sign</a></p>`,
    ...(p.applyUrl
      ? [`<p><a href="${escapeHtml(p.applyUrl)}">Apply with ${escapeHtml(p.lender)}</a></p>`]
      : []),
    `<p>${escapeHtml(p.companyName)}</p>`,
  ].join("\n");
  return { subject, html, text };
}

/** Why billing is refused on a contract paying with financing. */
export function financedBillingMessage(lender: string): string {
  return `This contract is being paid through ${lender}. Put the original schedule back (Financing panel) to bill it.`;
}
