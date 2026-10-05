/**
 * Byte-range passthrough for the recording proxy (/api/voice/recording).
 *
 * The browser asks for a slice of the recording ("Range: bytes=...")
 * whenever someone drags the player's bar or presses +10s. The proxy has
 * to ask Twilio's or CallRail's storage for that same slice and hand
 * back their 206 with its Content-Range, or the recording can only ever
 * be played from the start: given a plain 200 with no length, Chrome
 * reports the file as unseekable and greys the timeline out, and Safari
 * refuses to play it at all.
 */

/** The upstream fetch's headers: the caller's own plus the browser's Range, when it sent one. */
export function upstreamRecordingHeaders(
  range: string | null,
  extra: Record<string, string> = {}
): Record<string, string> {
  return range ? { ...extra, Range: range } : { ...extra };
}

/**
 * The status and headers the browser gets back, copied from the
 * provider's media response. Accept-Ranges is always advertised: the
 * providers serve slices, and a player that isn't told so never asks.
 */
export function recordingResponseInit(upstream: { status: number; headers: Headers }): {
  status: number;
  headers: Record<string, string>;
} {
  const partial = upstream.status === 206;
  const headers: Record<string, string> = {
    "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  const contentRange = upstream.headers.get("content-range");
  if (partial && contentRange) headers["Content-Range"] = contentRange;
  // fetch inflates a compressed body on the way in, so the provider's
  // byte count would not match what is streamed out.
  const length = upstream.headers.get("content-length");
  if (length && !upstream.headers.get("content-encoding")) headers["Content-Length"] = length;
  return { status: partial ? 206 : 200, headers };
}

/**
 * Whether a stored Twilio recording URL may be fetched with this
 * account's credentials.
 *
 * The proxy sends the company's account SID and auth token along with
 * the fetch, so the URL decides who receives them -- and call_logs rows
 * are written by more than the recording webhook. Only Twilio's own API
 * (api.twilio.com, or a regional api.<edge>.<region>.twilio.com), over
 * https, for a recording on that same account, ever gets them. Anything
 * else is answered as "no recording" without a request being made.
 */
export function twilioRecordingUrlAllowed(url: string, accountSid: string): boolean {
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const twilioApi = u.hostname === "api.twilio.com" || /^api(\.[a-z0-9-]+){2}\.twilio\.com$/.test(u.hostname);
  if (!twilioApi) return false;
  return new RegExp(`^/2010-04-01/Accounts/${accountSid}/Recordings/RE[0-9a-f]{32}(\\.(mp3|wav))?$`, "i").test(u.pathname);
}

/**
 * Which account's credentials may fetch a Twilio recording (DECISIONS #112).
 *
 * The company's own account, for a recording on that account. Otherwise
 * the shared account -- the server's TWILIO_* settings, La Home's -- but
 * only for a recording on that same account AND listed once, at the
 * switch, as one a company made while it borrowed the shared account
 * (`listedAtSwitch`). call_logs is writable by a company's own members,
 * so a URL alone never decides: an edited row pointing at La Home's
 * recording isn't on the list. Null: fetch nothing.
 */
export function recordingCredentialChoice(
  url: string,
  own: { accountSid: string } | null,
  shared: { accountSid: string } | null,
  listedAtSwitch: boolean
): "own" | "shared" | null {
  if (own && twilioRecordingUrlAllowed(url, own.accountSid)) return "own";
  if (shared && listedAtSwitch && twilioRecordingUrlAllowed(url, shared.accountSid)) return "shared";
  return null;
}
