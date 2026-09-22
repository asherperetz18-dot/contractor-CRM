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
