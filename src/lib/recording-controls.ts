/**
 * The arithmetic behind the recording player (src/components/recording-player.tsx):
 * where a skip lands, what the clock reads, which speed comes next.
 * Pure, so the player's buttons are pinned by recording-controls.test.ts.
 */

/** One press of the back/forward buttons, in seconds. */
export const SKIP_SECONDS = 10;

const SPEEDS = [1, 1.25, 1.5, 2];

/**
 * Where a seek lands: never before the start, never past the end. With
 * the length still unknown (nothing loaded yet, or a stream with no
 * metadata) only the floor applies, so +10s on an unplayed recording
 * still asks for ten seconds in.
 */
export function clampSeek(target: number, duration: number): number {
  const t = Number.isFinite(target) ? Math.max(0, target) : 0;
  return Number.isFinite(duration) && duration > 0 ? Math.min(t, duration) : t;
}

/** m:ss for the clock. Anything unreadable (NaN, Infinity, negative) reads 0:00. */
export function formatClock(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** The speed after `current` on the toggle; anything off the list restarts at 1×. */
export function nextSpeed(current: number): number {
  const i = SPEEDS.indexOf(current);
  return i === -1 ? SPEEDS[0] : SPEEDS[(i + 1) % SPEEDS.length];
}
