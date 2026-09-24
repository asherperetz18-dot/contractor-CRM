/**
 * PrimeCall (a NetSapiens-platform phone system) -- the pure rules.
 *
 * No runtime imports beyond node:crypto so everything here is tested
 * without a database or network (primecall.test.ts). The API calls and
 * the call_logs writes live in primecall-sync.ts.
 *
 * NetSapiens' v2 API writes one CDR per call LEG: a customer calling a
 * ring group of three desk phones is three rows sharing one
 * call-orig-call-id. A rep wants one line per phone call, so legs are
 * grouped on that id, and the leg that actually talked decides who
 * answered.
 */
import { timingSafeEqual } from "node:crypto";

/** The slice of a NetSapiens v2 CDR this integration reads. Types are
 *  loose on purpose: the spec itself has integers where strings arrive
 *  (call-orig-caller-id) and null where values arrive (call-term-user). */
export type NsCdr = {
  id?: string | number | null;
  "call-orig-call-id"?: string | null;
  "call-term-call-id"?: string | null;
  "call-orig-user"?: string | number | null;
  "call-orig-from-user"?: string | number | null;
  "call-orig-from-uri"?: string | null;
  "call-orig-from-name"?: string | null;
  "call-orig-caller-id"?: string | number | null;
  "call-orig-to-user"?: string | number | null;
  "call-orig-to-uri"?: string | null;
  "call-term-user"?: string | number | null;
  "call-term-to-uri"?: string | null;
  "call-start-datetime"?: string | null;
  "call-answer-datetime"?: string | null;
  "call-talking-duration-seconds"?: number | string | null;
  "call-total-duration-seconds"?: number | string | null;
};

export type PrimeCallDirection = "inbound" | "outbound";

/** One phone call, as Call Reports shows it. */
export type PrimeCallCall = {
  /** call-orig-call-id: the key a call is stored under, so a webhook
   *  nudge and the sweep re-reading the same call land as one row. */
  callId: string;
  direction: PrimeCallDirection;
  /** The customer's number: who called in, or who was dialed. */
  externalNumber: string;
  /** Our side: the number dialed in on, or the caller id sent out. */
  companyNumber: string;
  answered: boolean;
  /** Talk time of the longest leg -- ringing isn't a conversation. */
  durationSeconds: number;
  /** ISO start of the call, or null when NetSapiens gave none. */
  startedAt: string | null;
  /** The PrimeCall extension that answered (inbound) or dialed
   *  (outbound); null for a call nobody picked up. */
  extension: string | null;
  callerName: string | null;
  /** Call ids to ask the recordings endpoint about, in order. Empty
   *  for an unanswered call -- there is nothing to have recorded. */
  recordingCallIds: string[];
};

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** "sip:8185551234@host;user=phone" -> "8185551234". */
export function uriUser(uri: string | null | undefined): string {
  const s = str(uri).replace(/^<|>$/g, "");
  if (!s) return "";
  const noScheme = s.replace(/^(sips?|tel):/i, "");
  return noScheme.split(/[@;>]/)[0].trim();
}

/**
 * A NetSapiens datetime as ISO UTC, or null. Queries are sent in UTC
 * (nsDatetime) and the API answers "in the same format", but a bare
 * "2026-09-24 17:05:09" is read as UTC too rather than as the server's
 * local time. The all-zero value is NetSapiens for "never happened".
 */
export function parseNsDatetime(value: string | null | undefined): string | null {
  let s = str(value).replace(/\[[^\]]*\]$/, "");
  if (!s || /^0{4}-0{2}-0{2}/.test(s)) return null;
  s = s.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) s += "Z";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A query bound in the UTC form the API accepts: 2026-09-24T17:05:09Z. */
export function nsDatetime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isAnswered(l: NsCdr): boolean {
  return num(l["call-talking-duration-seconds"]) > 0 || parseNsDatetime(l["call-answer-datetime"]) !== null;
}

function customerNumber(first: NsCdr, direction: PrimeCallDirection): string {
  if (direction === "outbound") {
    return str(first["call-orig-to-user"]) || uriUser(first["call-orig-to-uri"]) || uriUser(first["call-term-to-uri"]);
  }
  return str(first["call-orig-from-user"]) || str(first["call-orig-caller-id"]) || uriUser(first["call-orig-from-uri"]);
}

function ourNumber(first: NsCdr, direction: PrimeCallDirection): string {
  if (direction === "outbound") return str(first["call-orig-caller-id"]);
  return str(first["call-orig-to-user"]) || uriUser(first["call-orig-to-uri"]);
}

/**
 * CDR legs -> one call each. `direction` comes from which query the
 * rows answered (the API's own Inbound/Missed/Outbound filter) rather
 * than from decoding the call-direction integer, whose values the spec
 * leaves undocumented.
 */
export function cdrsToCalls(cdrs: readonly NsCdr[], direction: PrimeCallDirection): PrimeCallCall[] {
  const groups = new Map<string, NsCdr[]>();
  for (const c of cdrs) {
    const key = str(c["call-orig-call-id"]) || str(c.id);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  const calls: PrimeCallCall[] = [];
  for (const [callId, legs] of groups) {
    const first = legs[0];
    const externalNumber = customerNumber(first, direction);
    if (!externalNumber) continue;

    // The leg that talked longest is the conversation; an answer time
    // with zero seconds still beats a leg that only rang.
    const answeredLegs = legs.filter(isAnswered);
    const talked = answeredLegs.reduce<NsCdr | null>(
      (best, l) =>
        !best || num(l["call-talking-duration-seconds"]) > num(best["call-talking-duration-seconds"]) ? l : best,
      null
    );

    const extension =
      direction === "outbound"
        ? str(first["call-orig-user"]) || null
        : talked
          ? str(talked["call-term-user"]) || uriUser(talked["call-term-to-uri"]) || null
          : null;

    const recordingCallIds = talked
      ? [callId, str(talked["call-term-call-id"])].filter((id, i, all) => id && all.indexOf(id) === i)
      : [];

    calls.push({
      callId,
      direction,
      externalNumber,
      companyNumber: ourNumber(first, direction),
      answered: !!talked,
      durationSeconds: talked ? num(talked["call-talking-duration-seconds"]) : 0,
      startedAt: parseNsDatetime(first["call-start-datetime"]),
      extension,
      callerName: str(first["call-orig-from-name"]) || null,
      recordingCallIds,
    });
  }
  return calls;
}

/**
 * The https origin of the company's NetSapiens server, from whatever an
 * admin pastes ("portal.primecall.com", a full API URL...), or null.
 * The API key is sent to this host on every request, so IP literals and
 * localhost are refused -- a stored address must never point the key
 * at our own network.
 */
export function normalizeServer(input: string | null | undefined): string | null {
  const raw = str(input);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".localhost")) return null;
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return null;
  return `https://${url.host.toLowerCase()}`;
}

export function nsApiBase(server: string): string {
  return `${server}/ns-api/v2`;
}

/**
 * PrimeCall extension -> CRM person, matched on email. Only an email
 * exactly one CRM user holds counts; anything else leaves the call
 * without a rep rather than crediting the wrong person.
 */
export function extensionRepMap(
  nsUsers: readonly { user?: string | number | null; "email-address"?: string | null }[],
  members: readonly { id: string; email: string | null }[]
): Map<string, string> {
  const byEmail = new Map<string, string[]>();
  for (const m of members) {
    const e = str(m.email).toLowerCase();
    if (!e) continue;
    byEmail.set(e, [...(byEmail.get(e) ?? []), m.id]);
  }
  const map = new Map<string, string>();
  for (const u of nsUsers) {
    const ext = str(u.user);
    const ids = byEmail.get(str(u["email-address"]).toLowerCase());
    if (ext && ids?.length === 1) map.set(ext, ids[0]);
  }
  return map;
}

const ALERT_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Whether a caller turned into a new lead is worth a text to the office.
 * The sweep re-reads hours of history; an alert about a call from this
 * morning is noise (CallRail's first backfill sent 45 of them).
 */
export function shouldAlertNewLead(startedAt: string | null, now: Date): boolean {
  if (!startedAt) return false;
  return now.getTime() - new Date(startedAt).getTime() <= ALERT_WINDOW_MS;
}

/** Constant-time compare of the webhook URL's token. */
export function tokenMatches(given: string | null | undefined, stored: string | null | undefined): boolean {
  if (!given || !stored) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}
