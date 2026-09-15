export type BulkEmailTarget = { id: string; email: string };

// A copy of email-env.ts's escapeHtml, not an import of it: that module
// starts with `import "server-only"`, which would make this file unusable
// from the compose modal (a client component) and untestable under
// `node --test` -- the same reason inbound-email.ts stays free of it.
function escapeHtml(value: string): string {
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

/**
 * Which of a set of selected leads actually get emailed.
 *
 * Deduped by email (case-insensitive) rather than by lead id -- two
 * contact records sharing one inbox must not double-send, the same
 * concern the Contacts duplicate-review banner flags for the same
 * underlying data.
 */
export function resolveBulkEmailTargets(
  leads: { id: string; email: string | null }[]
): { targets: BulkEmailTarget[]; skipped: number } {
  const targets: BulkEmailTarget[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const lead of leads) {
    const email = (lead.email ?? "").trim();
    if (!email) {
      skipped += 1;
      continue;
    }
    const key = email.toLowerCase();
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    targets.push({ id: lead.id, email });
  }
  return { targets, skipped };
}

export function buildBulkEmailContent(
  subject: string,
  message: string
): { subject: string; html: string; text: string } {
  const trimmedSubject = subject.trim();
  const trimmedMessage = message.trim();
  return {
    subject: trimmedSubject,
    text: trimmedMessage,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#1a1a1a">${escapeHtml(
      trimmedMessage
    ).replace(/\n/g, "<br>")}</div>`,
  };
}
