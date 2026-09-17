import "server-only";
import { withLegalFooter } from "./email-footer";
import { logError } from "@/lib/observability/logger";
import { captureError } from "@/lib/observability/sentry";

// Same BOM defense as twilio-env.ts -- `vercel env add` has intermittently
// prepended a UTF-8 BOM to piped-in values on this machine, and a BOM can
// never legitimately appear in an API key or address.
function stripBom(value: string): string {
  const trimmed = value.trim();
  return trimmed.charCodeAt(0) === 0xfeff ? trimmed.slice(1) : trimmed;
}

export function getEmailEnv() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return null;
  return { apiKey: stripBom(apiKey), from: stripBom(from) };
}

// An API key must go into an HTTP header, which only accepts single-byte
// characters. Copying a key from a UI that shows it truncated ("re_abc…xyz")
// smuggles in a U+2026 ellipsis and makes fetch throw a raw TypeError, so
// this is checked up front and reported in terms of the actual mistake.
function nonAsciiComplaint(label: string, value: string): string | null {
  const bad = [...value].find((ch) => ch.charCodeAt(0) > 255);
  if (!bad) return null;
  const detail = bad === "…" ? " It contains a “…”, which usually means only the shortened, visible part of the value was copied." : "";
  return `${label} has an invalid character.${detail} Re-copy the full value and save it again.`;
}

// Every value dropped into an HTML email body -- a lead's name, an
// estimate's title -- can originate from a public lead form or a rep's free
// text, so it must be neutralized before it lands in markup one of our own
// senders is the "from" address on. Covers both tag and attribute contexts
// (quotes included), unlike the TwiML-only escapeXml in the SMS webhook.
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

export type SendEmailResult = { id?: string; error?: string };
export type SendEmailOptions = {
  replyTo?: string;
  // A company's own sender, from getEmailForCompany -- falls back to the
  // platform env below when the caller has no company context (e.g. the
  // pre-login password-reset email, which isn't scoped to one company).
  env?: { apiKey: string; from: string };
  // Real, visible Cc/Bcc on the one message Resend sends -- everyone in
  // `to`/`cc` sees each other's address, same as any other mail client;
  // `bcc` stays invisible to all of them. Omit either for a plain send.
  cc?: string[];
  bcc?: string[];
};

export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
  text: string,
  options: SendEmailOptions = {}
): Promise<SendEmailResult> {
  const env = options.env ?? getEmailEnv();
  if (!env) {
    return {
      error:
        "Email isn't set up yet. Add RESEND_API_KEY and EMAIL_FROM in Settings to send email.",
    };
  }

  const keyProblem = nonAsciiComplaint("The email API key", env.apiKey);
  if (keyProblem) return { error: keyProblem };
  const fromProblem = nonAsciiComplaint("The sender address (EMAIL_FROM)", env.from);
  if (fromProblem) return { error: fromProblem };

  const branded = withLegalFooter(html, text);
  const body: Record<string, unknown> = {
    from: env.from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html: branded.html,
    text: branded.text,
  };
  if (options.replyTo) body.reply_to = options.replyTo;
  if (options.cc?.length) body.cc = options.cc;
  if (options.bcc?.length) body.bcc = options.bcc;

  // Network faults and malformed values surface as a readable message
  // instead of a 500 from an unhandled throw.
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => null)) as
      | { id?: string; message?: string; name?: string }
      | null;
    if (!res.ok) {
      const error = json?.message || `Could not send the email (HTTP ${res.status}).`;
      // Callers turn this into a quiet on-screen note (or nothing, on a
      // cron); the send failure itself belongs in the log and Sentry, or
      // "customers stopped getting emails" has no trail at all.
      logError({ event: "email.send.failed", service: "email", extra: { status: res.status } });
      captureError(new Error(error), { service: "email" });
      return { error };
    }
    return { id: json?.id };
  } catch (e) {
    logError({ event: "email.send.failed", service: "email" });
    captureError(e, { service: "email" });
    return {
      error: e instanceof Error ? `Could not send the email: ${e.message}` : "Could not send the email.",
    };
  }
}
