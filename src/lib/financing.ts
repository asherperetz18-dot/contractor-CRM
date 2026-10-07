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
