// No `import "server-only"` here, same as bulk-email.ts: sendEmail appends
// this footer, and node:test has to be able to import it.

/** The app owner's legal line — the LLC, not the domain. */
export const LEGAL_FOOTER = "© 2026 AI Build Pros LLC. All rights reserved.";

/**
 * Appends the legal footer to an outbound email's HTML and plain-text
 * bodies. Applied once, inside sendEmail, so every sender — portal links,
 * estimate signing, invites, bulk email — carries it without each template
 * repeating the line.
 */
export function withLegalFooter(html: string, text: string): { html: string; text: string } {
  return {
    html:
      html +
      `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e5e5;font-size:12px;color:#8a8a8a;text-align:center">${LEGAL_FOOTER}</div>`,
    text: `${text}\n\n${LEGAL_FOOTER}`,
  };
}
