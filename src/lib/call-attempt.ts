/**
 * The lifecycle latch for one dial attempt in the browser dialer.
 *
 * Twilio's Voice SDK fires more than one terminal event for a single
 * call: hanging up while it rings fires cancel AND disconnect, and a
 * gateway error at hang-up fires disconnect AND error. Every handler
 * used to log a call_logs row, so each attempt appeared twice in Call
 * Reports -- and the "stale gateway" auto-retry fired on late errors
 * too, re-dialing numbers whose phone had already rung. One latch per
 * attempt: the first terminal event settles it and logs; the rest
 * no-op. A retry is a fresh unsettled attempt that never rang, nothing
 * else.
 */

export type CallAttempt = {
  ringing: boolean;
  settled: boolean;
};

export function newCallAttempt(): CallAttempt {
  return { ringing: false, settled: false };
}

export function markRinging(attempt: CallAttempt): void {
  attempt.ringing = true;
}

/** True exactly once -- the caller that gets true logs the call. */
export function settleAttempt(attempt: CallAttempt): boolean {
  if (attempt.settled) return false;
  attempt.settled = true;
  return true;
}

/**
 * The one situation the silent rebuild-and-redial is for: the stale
 * gateway rejecting a brand-new call (31005 ConnectionError / 20104
 * expired token) before anything rang. A call that rang -- or already
 * ended -- reached a real phone; dialing it again is a second call.
 */
export function shouldRetryError(
  attempt: CallAttempt,
  code: number | undefined,
  alreadyRetried: boolean
): boolean {
  if (alreadyRetried) return false;
  if (code !== 31005 && code !== 20104) return false;
  return !attempt.ringing && !attempt.settled;
}
