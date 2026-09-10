import { test, expect } from "@playwright/test";

/**
 * Investigation, not just an assumption: before marking Twilio Voice
 * and screen-share as MANUAL REQUIRED, actually tried to exercise the
 * browser media APIs both features depend on, headless, in this
 * environment, with Chromium's fake-media-device flags
 * (--use-fake-device-for-media-stream --use-fake-ui-for-media-stream,
 * set once in playwright.config.ts).
 *
 * Result, reproduced multiple times, with and without an explicit
 * Playwright permission grant, with additional --use-file-for-fake-
 * audio-capture flags, with audio-only and video-only constraints
 * tried separately:
 *
 *   navigator.mediaDevices.getDisplayMedia({ video: true })  -> resolves
 *   navigator.mediaDevices.getUserMedia({ audio: true })     -> hangs
 *   navigator.mediaDevices.getUserMedia({ video: true })     -> hangs
 *   navigator.mediaDevices.getUserMedia({ audio: true, video: true }) -> hangs
 *
 * getDisplayMedia (screen/window capture) resolves cleanly under the
 * fake-UI flag. getUserMedia (camera/microphone) does not -- it hangs
 * indefinitely rather than rejecting, in this specific headless-
 * Chromium-on-macOS sandbox. This is a known category of platform
 * difference for Chromium's fake capture backend (better supported
 * headless on Linux); it is not a permanent Playwright limitation, and
 * is worth re-testing if this suite ever runs in a Linux CI environment
 * instead.
 *
 * Consequence for the two real features:
 *
 * - screen-share.tsx calls getUserMedia({ audio: true }) for the
 *   microphone alongside getDisplayMedia (and a separate
 *   getUserMedia({ video: ... }) for its camera-view mode) -- so even
 *   though getDisplayMedia alone works here, the ACTUAL feature's start
 *   flow cannot complete in this environment regardless.
 * - The Twilio Voice SDK opens a real Device against real Twilio
 *   infrastructure and needs a real Access Token (server-issued, tied
 *   to a real Twilio account) before it even attempts to acquire the
 *   microphone -- there is no real Twilio credential in this
 *   environment to get that far in the first place, on top of the
 *   getUserMedia issue above.
 *
 * Both stay MANUAL REQUIRED. The one thing this file automates: proof
 * that getDisplayMedia specifically is exercisable here, so a future
 * screen-share-only (no mic) code path, or a Linux CI run, isn't stuck
 * re-discovering this from scratch.
 */

test("getDisplayMedia resolves under fake-device flags in this environment (capability probe, not a feature test)", async ({
  page,
}) => {
  await page.goto("/login"); // any same-origin https/http page; getDisplayMedia needs a secure context
  const result = await page.evaluate(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const tracks = stream.getTracks().map((t) => t.kind);
      stream.getTracks().forEach((t) => t.stop());
      return { ok: true, tracks };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
});

test.skip(
  true,
  "MANUAL REQUIRED: getUserMedia (camera/microphone) reliably hangs under headless " +
    "Chromium in this environment (verified above, reproduced 5+ times with different " +
    "flags/constraints) -- screen-share's real start flow and any Twilio Voice call " +
    "both need it. Twilio additionally needs a real Access Token from a real Twilio " +
    "account, which does not exist in this environment. Full end-to-end verification " +
    "for both needs a human, with real Twilio credentials, on a real device, placing " +
    "or receiving a real call / sharing a real screen with a second real participant."
);
test("Twilio Voice call and full screen-share flow — real end-to-end", () => {
  // Intentionally empty: see the skip reason above.
});
