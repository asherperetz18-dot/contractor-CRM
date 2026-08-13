export type RepProfile = { email: string | null; name: string | null };

// A private copy rather than importing @/lib/html-escape: this file is
// reachable both from the real app (Next's bundler resolves the "@/"
// alias) and directly from node:test via rep-signed-notification.test.ts
// (plain ESM resolution, which understands neither the alias nor an
// extensionless relative import to a .ts file). Kept dependency-free, same
// reasoning as signature-evidence.ts.
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
 * Why the rep either did or didn't get told, distinguished rather than
 * collapsed into a single boolean -- so a server log can say which of
 * these happened instead of just "it didn't work". This is what production
 * was missing: sendEmail resolves with `{ error }` on failure rather than
 * throwing, and the previous code never looked at the result, so a failed
 * send and a successful one were indistinguishable from the outside.
 */
export type NotifyRepResult =
  | { outcome: "no_assigned_rep" }
  | { outcome: "rep_profile_missing" }
  | { outcome: "rep_email_missing" }
  | { outcome: "send_failed"; error: string }
  | { outcome: "error"; error: string }
  | { outcome: "sent" };

function labelFor(kind: string): string {
  if (kind === "change_order") return "change order";
  if (kind === "completion") return "completion certificate";
  return "estimate";
}

export function buildRepSignedEmail(params: {
  docNumber: string;
  kind: string;
  repName: string | null;
  link: string;
}) {
  const { docNumber, kind, repName, link } = params;
  const label = labelFor(kind);
  const greeting = repName ? repName.split(" ")[0] : "there";
  const subject = `${docNumber} was just signed`;
  const text = [
    `Hi ${greeting},`,
    ``,
    `Your customer just signed ${label} ${docNumber}.`,
    `View it here: ${link}`,
  ].join("\n");

  // repName is a staff-entered profile field and label is one of three
  // hardcoded strings, but escaped anyway rather than judging each value
  // safe on its own -- docNumber is the one that could ever change shape,
  // and consistency here is cheaper than re-litigating it later.
  const safeGreeting = escapeHtml(greeting);
  const safeDocNumber = escapeHtml(docNumber);
  const safeLink = escapeHtml(link);
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#1a1a1a">
      <p>Hi ${safeGreeting},</p>
      <p>Your customer just signed ${label} <strong>${safeDocNumber}</strong>.</p>
      <p><a href="${safeLink}" style="display:inline-block;background:#C2410C;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">View it</a></p>
    </div>
  `;
  return { subject, text, html };
}

/**
 * Tells the assigned rep a document was fully signed, or reports exactly
 * why it couldn't -- unassigned, the profile's gone, no email on file, the
 * send itself failed, or something in this path threw outright. lookupRep
 * and sendEmail are passed in rather than imported directly so this can be
 * unit tested against fakes instead of a real Supabase client and a real
 * Resend call.
 *
 * Never rejects, by design: the caller (signEstimateAsCustomer) runs this
 * after the customer's signature is already committed, and a notification
 * problem -- of any kind, including one neither of these dependencies was
 * expected to produce -- must never look like the signature itself failed.
 */
export async function notifyRepOfSignature(params: {
  assignedTo: string | null;
  lookupRep: (profileId: string) => Promise<RepProfile | null>;
  sendEmail: (
    to: string,
    subject: string,
    html: string,
    text: string
  ) => Promise<{ id?: string; error?: string }>;
  docNumber: string;
  kind: string;
  link: string;
}): Promise<NotifyRepResult> {
  try {
    const { assignedTo, lookupRep, sendEmail, docNumber, kind, link } = params;
    if (!assignedTo) return { outcome: "no_assigned_rep" };

    const rep = await lookupRep(assignedTo);
    if (!rep) return { outcome: "rep_profile_missing" };
    if (!rep.email) return { outcome: "rep_email_missing" };

    const mail = buildRepSignedEmail({ docNumber, kind, repName: rep.name, link });
    const sent = await sendEmail(rep.email, mail.subject, mail.html, mail.text);
    if (sent.error) return { outcome: "send_failed", error: sent.error };
    return { outcome: "sent" };
  } catch (e) {
    return { outcome: "error", error: e instanceof Error ? e.message : "Unknown error" };
  }
}
