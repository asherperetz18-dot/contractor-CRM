// Turning a forwarded lead-source email (Home Depot Pro Referral, Angi,
// Yelp, an answering service) into lead fields. Pure functions, so the
// parsing is unit-testable without Resend in the loop.

export type ParsedLeadEmail = {
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  projectType: string | null;
  message: string | null;
  source: string;
};

/** Sender addresses that name a SERVICE, not the customer. */
const SERVICE_NAMES =
  /pro referral|proreferral|home depot|angi|angie|homeadvisor|yelp|thumbtack|houzz|no.?reply|notification|do.?not.?reply|support|alerts?|leads?@/i;

const SOURCE_MAP: [RegExp, string][] = [
  [/proreferral|homedepot/i, "Home Depot Pro Referral"],
  [/angi\.com|angieslist|homeadvisor/i, "Angi"],
  [/yelp/i, "Yelp"],
  [/thumbtack/i, "Thumbtack"],
  [/houzz/i, "Houzz"],
  [/facebook|meta\.com/i, "Facebook"],
  [/google/i, "Google"],
  [/nextdoor/i, "Nextdoor"],
];

export function sourceForSender(address: string): string {
  for (const [re, name] of SOURCE_MAP) if (re.test(address)) return name;
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  return domain ? `Email: ${domain}` : "Email";
}

/**
 * The ORIGINAL sender of a forwarded email. Auto-forwarding from Gmail
 * or Outlook makes the envelope sender the user's own mailbox; the
 * service that actually wrote the email sits in a "From:" line inside
 * the forwarded body. Without this, every forwarded lead would be
 * attributed to "Email: gmail.com".
 */
export function originalSender(from: string, text: string): string {
  const m =
    text.match(/^\s*>?\s*From:\s*(?:"?([^"<\r\n]*)"?\s*)?<?([^\s<>@]+@[^\s<>]+)>?/im) ?? null;
  if (m?.[2]) return `${(m[1] ?? "").trim()} <${m[2].trim()}>`;
  return from;
}

function addressOf(sender: string): string {
  const m = sender.match(/<([^<>]+)>/);
  return (m?.[1] ?? sender).trim().toLowerCase();
}

function displayNameOf(sender: string): string | null {
  const m = sender.match(/^\s*"?([^"<]+?)"?\s*</);
  const name = m?.[1]?.trim();
  if (!name || SERVICE_NAMES.test(name)) return null;
  return name;
}

/** Crude but serviceable text extraction when a sender is HTML-only. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const LABELS: { key: keyof ParsedLeadEmail; re: RegExp }[] = [
  { key: "name", re: /^(?:customer(?: name)?|client(?: name)?|name|full name|contact(?: name)?)\s*[:\-]\s*(.+)$/i },
  { key: "phone", re: /^(?:phone(?: number)?|tel(?:ephone)?|mobile|cell)\s*[:\-]\s*(.+)$/i },
  { key: "email", re: /^(?:e-?mail(?: address)?)\s*[:\-]\s*(.+)$/i },
  { key: "address", re: /^(?:address|location|job (?:site|address)|city|service area)\s*[:\-]\s*(.+)$/i },
  { key: "projectType", re: /^(?:project(?: type)?|service(?: type| needed)?|job type|category|work (?:type|needed))\s*[:\-]\s*(.+)$/i },
  { key: "message", re: /^(?:message|details|description|notes?|comments?|project description)\s*[:\-]\s*(.+)$/i },
];

const PHONE_RE = /(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b/;
const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;

/**
 * Best-effort lead fields from a lead-source email. Labeled lines win;
 * regex sweeps fill the gaps; the whole readable body rides along in
 * the notes so nothing the service sent is lost, whatever the format.
 */
export function parseLeadEmail(input: {
  from: string;
  subject: string;
  text: string | null;
  html: string | null;
}): ParsedLeadEmail {
  const text = (input.text?.trim() || htmlToText(input.html ?? "")).replace(/\r\n/g, "\n");
  const sender = originalSender(input.from, text);
  const senderAddress = addressOf(sender);

  const out: ParsedLeadEmail = {
    name: null,
    phone: null,
    email: null,
    address: null,
    projectType: null,
    message: null,
    source: sourceForSender(senderAddress),
  };

  for (const line of text.split("\n")) {
    const clean = line.replace(/^\s*>+\s*/, "").trim();
    if (!clean) continue;
    for (const { key, re } of LABELS) {
      if (out[key]) continue;
      const m = clean.match(re);
      if (m) out[key] = m[1].trim().slice(0, 200) as never;
    }
  }

  if (!out.phone) {
    const m = text.match(PHONE_RE);
    if (m) out.phone = m[0].trim();
  }
  if (!out.email) {
    const forwarderAddress = addressOf(input.from);
    const candidates = [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];
    out.email =
      candidates.find(
        (e) =>
          e !== senderAddress &&
          e !== forwarderAddress &&
          !SERVICE_NAMES.test(e) &&
          !/@(?:.*\.)?(resend\.app|aibuildpros\.com)$/.test(e)
      ) ?? null;
  }
  if (!out.name) out.name = displayNameOf(sender);

  // The notes carry the subject and the readable body, so whatever the
  // parser missed is still one glance away on the lead card.
  const body = text.replace(/\n{3,}/g, "\n\n").slice(0, 1500);
  out.message = [input.subject?.trim(), out.message, body].filter(Boolean).join("\n\n").slice(0, 1800) || null;

  return out;
}
