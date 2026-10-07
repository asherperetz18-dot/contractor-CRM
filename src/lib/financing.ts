import { addDays } from "./company-clock.ts";
import { isUnfinishedCheckout, phaseNetCents } from "./data/types.ts";

/**
 * Customer financing, step 1 (DECISIONS #161). A company pastes in the
 * application link from its own lender's dashboard (Wisetack, Hearth,
 * GreenSky or another), and its customers see "Apply for financing" on
 * their estimates and contracts. The application, the
 * decision and the terms are the lender's: the CRM states no rate and no
 * monthly payment, which only the lender can, with its own disclosures.
 */

export type CompanyFinancing = { provider: string; url: string };

const MAX_URL = 500;
const MAX_PROVIDER = 60;

/**
 * Addresses a company may copy from its own browser that aren't the link
 * for customers: a lender's application form, which opens only for a
 * browser that already came through the dealer's link (the company's
 * did, so it "works" for them), and the page the lender shows when it
 * refuses. Customers sent there get Access Denied.
 */
const NOT_THE_CUSTOMER_LINK: { host: string; paths: string[]; why: string }[] = [
  {
    host: "apply.svcfin.com",
    paths: ["/embedded", "/home/denied"],
    why:
      "That's Service Finance's application page, not the link to it: it only opens in a browser that already used your dealer link, so customers get Access Denied. Paste your customer application link instead. It starts https://apply.svcfin.com/home/dealerAuthentication?id= and is in your Service Finance dealer portal, or ask their dealer line.",
  },
];

/** Why this link can't be a lender's public application page, or null. */
function linkError(raw: string): string | null {
  if (!/^https:\/\//i.test(raw)) return "The link must start with https://.";
  if (raw.length > MAX_URL) return "That link is too long.";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That doesn't look like a link. Copy it from your lender's dashboard.";
  }
  // A public page has a real host name and no sign-in in the address.
  if (!url.hostname.includes(".") || url.username || url.password) {
    return "That doesn't look like a lender's public link. Copy it from your lender's dashboard.";
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase().replace(/\/+$/, "");
  const known = NOT_THE_CUSTOMER_LINK.find((k) => k.host === host && k.paths.includes(path));
  if (known) return known.why;
  return null;
}

/** What's wrong with what the office typed; null when it can be saved.
 *  Both empty switches financing off. */
export function financingSettingsError(input: { provider: string; url: string }): string | null {
  const provider = input.provider.trim();
  const url = input.url.trim();
  if (!provider && !url) return null;
  if (!url) return "Paste the application link your lender gave you.";
  if (!provider) return "Say which lender it is: customers see the name.";
  if (provider.length > MAX_PROVIDER) return "The lender's name is too long.";
  return linkError(url);
}

/** The company's financing as saved, or null when it has none (or the
 *  database is from before 0214). */
export function readFinancing(
  row: { financing_provider?: string | null; financing_url?: string | null } | null
): CompanyFinancing | null {
  const provider = row?.financing_provider?.trim() ?? "";
  const url = row?.financing_url?.trim() ?? "";
  if (!provider || !url || provider.length > MAX_PROVIDER || linkError(url)) return null;
  return { provider, url };
}

/**
 * Whether a document gets the offer: an estimate, contract or change
 * order still open, or signed with money left to pay. Never one that's
 * declined, cancelled or expired, one paid for, an invoice (a permit fee
 * billed back) or a completion certificate.
 */
export function showFinancingOffer(doc: {
  /** The document's kind (contract, change_order, completion, invoice). */
  kind: string | null;
  status: string;
  expired: boolean;
  /** Signed, and every payment on it made. */
  settled: boolean;
}): boolean {
  const kind = doc.kind ?? "contract";
  if (kind !== "contract" && kind !== "change_order") return false;
  if (doc.status === "Declined" || doc.status === "Void" || doc.status === "Draft") return false;
  if (doc.status === "Signed") return !doc.settled;
  return !doc.expired;
}

// ---------------------------------------------------------------------
// Part two (DECISIONS #162): on the estimate, the office sends the
// customer the link and keeps track of where the application stands. By
// hand -- nothing comes back from the lender yet.

export const FINANCING_STATUSES = ["sent", "applied", "approved", "declined", "funded"] as const;
export type FinancingStatus = (typeof FINANCING_STATUSES)[number];

export const FINANCING_STATUS_LABEL: Record<FinancingStatus, string> = {
  sent: "Link sent",
  applied: "Applied",
  approved: "Approved",
  declined: "Declined",
  funded: "Funded",
};

/** One step, as estimate_financing_events (0215) keeps it. */
export type FinancingEvent = {
  status: FinancingStatus;
  amount_cents: number | null;
  note: string | null;
  created_at: string;
};

/** Where the estimate's financing stands: its newest step. */
export function currentFinancing<T extends FinancingEvent>(events: T[]): T | null {
  let newest: T | null = null;
  for (const e of events) {
    if (!newest || new Date(e.created_at).getTime() > new Date(newest.created_at).getTime()) newest = e;
  }
  return newest;
}

const MAX_AMOUNT = 10_000_000_000;
const MAX_NOTE = 500;

/** What's wrong with a step the office is recording, or null. */
export function financingEventError(input: { status: string; amountCents?: number | null; note?: string | null }): string | null {
  if (!(FINANCING_STATUSES as readonly string[]).includes(input.status)) return "Pick a status.";
  const amount = input.amountCents;
  if (amount !== undefined && amount !== null) {
    if (input.status !== "approved" && input.status !== "funded") {
      return "An amount goes only with Approved or Funded.";
    }
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) return "Enter an amount greater than zero.";
  }
  if ((input.note ?? "").trim().length > MAX_NOTE) return "That note is too long.";
  return null;
}

/**
 * Applied or approved puts the lead at Pending Finance -- unless it's
 * already there or further along (Close to Sale, Won), or it's do not
 * contact. A company's own untagged stage moves, as an estimate sent does.
 */
export function movesToPendingFinance(status: FinancingStatus, stageKey: string | null): boolean {
  if (status !== "applied" && status !== "approved") return false;
  return !["pending_finance", "close_to_sale", "won", "dnc"].includes(stageKey ?? "");
}

// On the pipeline (DECISIONS #165): each card shows where its customer's
// financing stands -- the newest step on any of the lead's live estimates
// -- and how long it's been there, so a stuck application stands out.

/** Where a lead's financing stands. */
export type LeadFinancing = { status: FinancingStatus; at: string; docNumber: string };

/** By lead id: the newest step on each lead's live estimates (not a
 *  draft, a void or declined one, or an invoice). Steps on estimates
 *  not in `estimates` -- one the person can't see -- count for nothing. */
export function leadFinancing(
  estimates: { id: string; lead_id: string | null; status: string; kind: string | null; doc_number: string }[],
  events: { estimate_id: string; status: string; created_at: string }[]
): Record<string, LeadFinancing> {
  const live = new Map<string, { lead_id: string; doc_number: string }>();
  for (const e of estimates) {
    if (!e.lead_id || (e.kind ?? "contract") === "invoice") continue;
    if (e.status === "Draft" || e.status === "Void" || e.status === "Declined") continue;
    live.set(e.id, { lead_id: e.lead_id, doc_number: e.doc_number });
  }
  const out: Record<string, LeadFinancing> = {};
  for (const ev of events) {
    const doc = live.get(ev.estimate_id);
    if (!doc || !(FINANCING_STATUSES as readonly string[]).includes(ev.status)) continue;
    const now = out[doc.lead_id];
    if (now && new Date(now.at).getTime() >= new Date(ev.created_at).getTime()) continue;
    out[doc.lead_id] = { status: ev.status as FinancingStatus, at: ev.created_at, docNumber: doc.doc_number };
  }
  return out;
}

/** The card's line: the step, how long ago, and whether it's waiting on
 *  someone, good news or bad. */
export function financingChip(
  f: LeadFinancing,
  daysAgo: number
): { text: string; title: string; tone: "waiting" | "good" | "bad" } {
  const label = FINANCING_STATUS_LABEL[f.status];
  const days = Math.max(0, daysAgo);
  return {
    text: `Financing: ${label} · ${days === 0 ? "today" : `${days}d`}`,
    title: `${f.docNumber}: ${label} ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}`,
    tone: f.status === "declined" ? "bad" : f.status === "approved" || f.status === "funded" ? "good" : "waiting",
  };
}

// Follow-ups (DECISIONS #164): a link sent or an application in puts a
// task on the list of whoever recorded it, a few days out, so the
// customer isn't left waiting on nobody. The next step closes it.

/** The choices offered, in days. */
export const FOLLOW_UP_DAYS = [1, 2, 3, 5, 7] as const;
const DEFAULT_FOLLOW_UP_DAYS = 3;

/** A step worth following up: the customer has the link, or has applied. */
export function remindsFor(status: FinancingStatus): boolean {
  return status === "sent" || status === "applied";
}

/** The day the follow-up is due: `days` after the company's today. */
export function followUpDue(today: string, days: number): string {
  const n = (FOLLOW_UP_DAYS as readonly number[]).includes(days) ? days : DEFAULT_FOLLOW_UP_DAYS;
  return addDays(today, n);
}

/** The task, as it reads on the Tasks page. */
export function followUpTitle(status: "sent" | "applied", docNumber: string, lender: string | null): string {
  return status === "sent"
    ? `Financing on ${docNumber}: did they apply with ${lender || "the lender"}?`
    : `Financing on ${docNumber}: has ${lender || "the lender"} decided?`;
}

/** The text to the customer. A plain hyphen: an em dash re-encodes the
 *  whole text and shrinks each segment from 160 characters to 70. */
export function financingText(p: { companyName: string; provider: string; url: string; docNumber: string }): string {
  return `${p.companyName}: you can apply for financing for ${p.docNumber} with ${p.provider} here:\n${p.url}\n\n${p.provider} decides on your application and sets its terms.`;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** The email to the customer, with the same words as the portal card. */
export function financingEmail(p: {
  companyName: string;
  customerName: string | null;
  provider: string;
  url: string;
  docNumber: string;
  title: string | null;
}): { subject: string; text: string; html: string } {
  const subject = `${p.companyName}: apply for financing with ${p.provider}`;
  const greeting = p.customerName?.trim() || "there";
  const doc = p.title?.trim() ? `${p.docNumber} (${p.title.trim()})` : p.docNumber;
  const opening = `You can apply for financing for ${doc} with ${p.provider}.`;
  const terms = `You'll apply on ${p.provider}'s website. ${p.provider} decides on your application and sets its terms.`;
  const text = [
    `Hi ${greeting},`,
    ``,
    opening,
    ``,
    `Apply for financing: ${p.url}`,
    ``,
    terms,
    ``,
    `Questions? Just reply to this email.`,
    ``,
    `Thank you,`,
    p.companyName,
  ].join("\n");
  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:640px">`,
    `<p>Hi ${escapeHtml(greeting)},</p>`,
    `<p>${escapeHtml(opening)}</p>`,
    `<p><a href="${escapeHtml(p.url)}" style="display:inline-block;background:#c8601f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold">Apply for financing</a></p>`,
    `<p style="font-size:13px;color:#666">${escapeHtml(terms)}</p>`,
    `<p style="font-size:13px;color:#666">Questions? Just reply to this email.</p>`,
    `<p>Thank you,<br>${escapeHtml(p.companyName)}</p>`,
    `</div>`,
  ].join("");
  return { subject, text, html };
}

// ---------------------------------------------------------------------
// A funded loan, recorded as the money it is (DECISIONS #163). The
// lender pays the contractor; the customer now owes the lender. So the
// payout settles what's left on the contract, as Financing payments.

export type LoanPart = {
  /** The stage it pays, or null for the deposit. */
  phaseId: string | null;
  label: string;
  cents: number;
};

export type LoanStage = {
  id: string;
  name: string;
  sort_order: number;
  amount_cents: number;
  credit_cents?: number | null;
  cancelled_at?: string | null;
};

export type LoanPayment = {
  estimate_payment_id: string | null;
  kind: string;
  status: string;
  amount_cents: number;
  stripe_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
};

/**
 * Where a payout goes: the deposit first, then each stage in schedule
 * order -- billed yet or not, since the loan pays for the whole job --
 * each up to what's still to pay on it: its amount less credits, money
 * settled and money on its way (a checkout opened and left is nothing).
 * Never a cancelled stage. More than is still owed comes back as
 * `overCents` and isn't split.
 */
export function splitFundedLoan(input: {
  amountCents: number;
  /** The contract's deposit, as its rule makes it. */
  depositDueCents: number;
  stages: LoanStage[];
  payments: LoanPayment[];
}): { parts: LoanPart[]; openCents: number; leftCents: number; overCents: number } {
  const counted = input.payments.filter(
    (p) =>
      p.status === "succeeded" ||
      (p.status === "pending" &&
        p.amount_cents > 0 &&
        !isUnfinishedCheckout({
          status: p.status,
          stripe_session_id: p.stripe_session_id ?? null,
          stripe_payment_intent_id: p.stripe_payment_intent_id ?? null,
        }))
  );
  const onIt = (phaseId: string | null) =>
    counted
      .filter((p) => (phaseId ? p.estimate_payment_id === phaseId : !p.estimate_payment_id && p.kind === "deposit"))
      .reduce((sum, p) => sum + p.amount_cents, 0);

  const open: LoanPart[] = [];
  const depositOpen = Math.max(0, input.depositDueCents - onIt(null));
  if (depositOpen > 0) open.push({ phaseId: null, label: "Deposit", cents: depositOpen });
  for (const st of [...input.stages].filter((x) => !x.cancelled_at).sort((a, b) => a.sort_order - b.sort_order)) {
    const left = Math.max(0, phaseNetCents(st) - onIt(st.id));
    if (left > 0) open.push({ phaseId: st.id, label: st.name || "Stage", cents: left });
  }

  const openCents = open.reduce((sum, p) => sum + p.cents, 0);
  const amount = Math.max(0, Math.round(input.amountCents));
  if (amount > openCents) return { parts: [], openCents, leftCents: openCents, overCents: amount - openCents };

  const parts: LoanPart[] = [];
  let rest = amount;
  for (const o of open) {
    if (rest <= 0) break;
    const cents = Math.min(rest, o.cents);
    parts.push({ ...o, cents });
    rest -= cents;
  }
  return { parts, openCents, leftCents: openCents - amount, overCents: 0 };
}
