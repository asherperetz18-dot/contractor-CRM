/**
 * What the browser dialer tells the rep when a call can't start.
 *
 * When Twilio refuses the calling pass (an API key and secret that don't
 * belong together, or a key from another Twilio account), the Voice SDK
 * closes its connection and rejects connect() with nothing at all. The
 * reason arrives separately, as an "error" event on the Device. The
 * dialer never listened for it, so every refusal read "Could not place
 * the call." -- and the closed connection was reused for every later
 * try, so even a fixed key kept failing until the page was reloaded
 * (DECISIONS #106).
 */

export type DeviceError = { code?: number; message?: string };

/**
 * The calling pass itself was refused: the saved API key, secret, TwiML app
 * or account don't belong together. 31100 is what Twilio answered for Ca Pro
 * Builder's setup, saved before the save-time checks existed (DECISIONS #107).
 */
const KEY_CODES = new Set([20101, 20102, 20103, 20106, 20107, 20151, 31100, 31201, 31202, 31203, 31204]);
/** The calling pass ran out; a fresh one fixes it. */
const EXPIRED_CODES = new Set([20104, 31205]);
/** The microphone was refused (31401) or wouldn't open (31402). */
const MIC_DENIED = 31401;
const MIC_FAILED = 31402;

function codeOf(err: unknown): number | undefined {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === "number" ? code : undefined;
}

/**
 * The sentence shown under the dialer for a call that never started.
 * `inApp` is the phone app, where a blocked microphone is fixed in the
 * phone's Settings rather than the browser (DECISIONS #108).
 */
export function callFailureMessage(err: unknown, deviceError: DeviceError | null, inApp = false): string {
  const code = codeOf(err) ?? deviceError?.code;
  if (code === MIC_DENIED) {
    return inApp
      ? "The app isn't allowed to use the microphone, so the call can't start. Open your phone's Settings → Apps → AI Build Pros CRM → Permissions → Microphone, choose Allow, then try again."
      : "The browser blocked the microphone, so the call can't start. Allow the microphone for this site (the icon left of the address bar), then try again.";
  }
  if (code === MIC_FAILED) {
    return "The microphone couldn't be opened, so the call can't start. Make sure another app isn't using it, then try again.";
  }
  if (code !== undefined && KEY_CODES.has(code)) {
    return `Twilio didn't accept this company's calling setup (error ${code}). An admin should re-enter it in Settings → Twilio → Replace → in-app calling, with the API key and TwiML App both made in the same Twilio account as the number.`;
  }
  if (code !== undefined && EXPIRED_CODES.has(code)) {
    return "The calling pass expired. Please try again.";
  }
  if (err instanceof Error && err.message) return err.message;
  if (deviceError) {
    return `Twilio couldn't start the call${code !== undefined ? ` (error ${code})` : ""}: ${deviceError.message || "no reason given"}.`;
  }
  return "Twilio closed the connection before the call started. Please try again. If it keeps happening, an admin should re-check in-app calling in Settings → Twilio.";
}

/**
 * Whether to throw away the Twilio connection so the next try builds a new
 * one with a fresh calling pass. Yes after a refusal or a reasonless close
 * (that connection is dead); never for an ordinary error such as "A Call
 * is already active", where tearing it down would hang up a live call.
 */
export function shouldRebuildDevice(err: unknown, deviceError: DeviceError | null): boolean {
  const code = codeOf(err) ?? deviceError?.code;
  if (code !== undefined && (KEY_CODES.has(code) || EXPIRED_CODES.has(code))) return true;
  return !(err instanceof Error);
}
