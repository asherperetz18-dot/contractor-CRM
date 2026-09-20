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

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** "PDT", "PST", "UTC" -- the label the time is printed with. */
  zoneName: string;
};

/**
 * The instant on the wall clock of `timeZone`, or UTC when no zone is
 * given or the zone is unknown. Only the zone conversion is left to
 * Intl; the label is assembled by hand below because the document
 * renders on the server, and an ICU upgrade changing a separator must
 * not silently reword what is presented as signing evidence.
 */
function wallClock(d: Date, timeZone: string | null | undefined): WallClock {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZoneName: "short",
      }).formatToParts(d);
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      return {
        year: Number(get("year")),
        month: Number(get("month")),
        day: Number(get("day")),
        hour: Number(get("hour")) % 24,
        minute: Number(get("minute")),
        zoneName: get("timeZoneName") || timeZone,
      };
    } catch {
      // RangeError: not an IANA zone Intl knows. Fall through to UTC,
      // labelled as such, rather than print nothing or guess.
    }
  }
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    zoneName: "UTC",
  };
}

/**
 * The evidence line printed under a signature on the document and its PDF:
 * "Signed Sep 20, 2026, 10:57 AM PDT · IP 146.75.146.1".
 *
 * In the company's own clock when a zone is given -- the contract is
 * signed in the company's market, and a California owner reading "5:57
 * PM UTC" under their own contractor's signature took it for a wrong
 * time (it was 10:57 AM to everyone in the room). The zone is always
 * printed, so nobody has to guess which clock it was; with no zone the
 * line stays UTC, labelled, as it always was.
 *
 * Null when there is nothing honest to show: an unsigned line, or a paper
 * signature, whose signed_at is a hand-entered date (no captured instant,
 * no IP) -- printing "12:00 AM" there would be fabricated precision.
 */
export function signatureEvidenceLine(
  signer: {
    signed_at: string | null;
    signature_ip: string | null;
    signature_type?: "typed" | "drawn" | "paper";
  },
  timeZone?: string | null
): string | null {
  if (!signer.signed_at || signer.signature_type === "paper") return null;
  const d = new Date(signer.signed_at);
  if (isNaN(d.getTime())) return null;
  const w = wallClock(d, timeZone);
  const h12 = w.hour % 12 === 0 ? 12 : w.hour % 12;
  const period = w.hour >= 12 ? "PM" : "AM";
  const mm = String(w.minute).padStart(2, "0");
  const when = `${MONTHS[w.month - 1]} ${w.day}, ${w.year}, ${h12}:${mm} ${period} ${w.zoneName}`;
  return `Signed ${when}${signer.signature_ip ? ` · IP ${signer.signature_ip}` : ""}`;
}

/**
 * The calendar date a signature was made -- "9/20/2026" -- on the same
 * clock as the evidence line, so the two never disagree about which day
 * it was (an evening signature in Los Angeles is already tomorrow in
 * UTC). Null for an unsigned line.
 */
export function signedOnLabel(
  signedAt: string | null,
  timeZone?: string | null
): string | null {
  if (!signedAt) return null;
  const d = new Date(signedAt);
  if (isNaN(d.getTime())) return null;
  const w = wallClock(d, timeZone);
  return `${w.month}/${w.day}/${w.year}`;
}
