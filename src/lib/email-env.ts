import "server-only";

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

export type SendEmailResult = { id?: string; error?: string };

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<SendEmailResult> {
  const env = getEmailEnv();
  if (!env) {
    return {
      error:
        "Email isn't set up yet. Add RESEND_API_KEY and EMAIL_FROM in Settings to send email.",
    };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.from, to: [to], subject, html, text }),
  });

  const json = (await res.json().catch(() => null)) as
    | { id?: string; message?: string; name?: string }
    | null;
  if (!res.ok) {
    return { error: json?.message || "Could not send the email." };
  }
  return { id: json?.id };
}
