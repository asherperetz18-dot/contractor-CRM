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
