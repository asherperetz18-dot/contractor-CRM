/**
 * The client's IP for e-signature evidence, in trust order for a Vercel
 * deployment.
 *
 * x-vercel-forwarded-for is Vercel's own header, and the one they document
 * as reliably reflecting the actual visitor for a function running on
 * their platform. x-forwarded-for and x-real-ip are kept as fallbacks --
 * useful outside Vercel (e.g. a local dev server) -- but on Vercel itself
 * they pass through more of the stack unmodified and are not guaranteed to
 * carry the same value, which is why production signatures were landing
 * with no IP at all: the old code only ever looked at those two.
 */
export function resolveClientIp(head: Headers): string | null {
  const candidates = [
    head.get("x-vercel-forwarded-for"),
    head.get("x-forwarded-for"),
    head.get("x-real-ip"),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    // A forwarded-for value is a comma-separated hop chain, client first --
    // "client, proxy1, proxy2". Only the first entry is the visitor; the
    // rest is infrastructure and must never be stored as if it were them.
    const first = raw.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

export type SignatureEvidence = {
  ip: string | null;
  userAgent: string | null;
  signedAt: string;
};

/**
 * Everything recorded about who signed, from where, and when -- read
 * entirely from the server's own view of the request. Never accepts an IP,
 * user agent, or timestamp supplied by the client itself; a signer's own
 * browser is exactly who this evidence needs to be independent of.
 *
 * signedAt is passed in rather than read from the clock here, so the whole
 * action shares one timestamp instead of this and the rest of the sign
 * flow disagreeing by a few milliseconds.
 */
export function collectSignatureEvidence(head: Headers, signedAt: string): SignatureEvidence {
  return {
    ip: resolveClientIp(head),
    userAgent: head.get("user-agent"),
    signedAt,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The evidence line printed under a signature on the document and its PDF:
 * "Signed Aug 28, 2026, 9:41 PM UTC · IP 203.0.113.5".
 *
 * Formatted by hand rather than with toLocaleString because the document
 * renders on the server: an ICU upgrade changing the separator (newer ICU
 * puts a narrow no-break space before AM/PM) must not silently reword what
 * is presented as signing evidence. UTC, labelled, for the same reason --
 * the server has no idea what timezone the signer was in, and an
 * unlabelled local-looking time on a contract invites disputes about
 * which clock it was.
 *
 * Null when there is nothing honest to show: an unsigned line, or a paper
 * signature, whose signed_at is a hand-entered date (no captured instant,
 * no IP) -- printing "12:00 AM UTC" there would be fabricated precision.
 */
export function signatureEvidenceLine(signer: {
  signed_at: string | null;
  signature_ip: string | null;
  signature_type?: "typed" | "drawn" | "paper";
}): string | null {
  if (!signer.signed_at || signer.signature_type === "paper") return null;
  const d = new Date(signer.signed_at);
  if (isNaN(d.getTime())) return null;
  const h = d.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const period = h >= 12 ? "PM" : "AM";
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const when = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${h12}:${mm} ${period} UTC`;
  return `Signed ${when}${signer.signature_ip ? ` · IP ${signer.signature_ip}` : ""}`;
}
