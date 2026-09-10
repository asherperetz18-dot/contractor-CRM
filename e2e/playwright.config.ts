import { defineConfig } from "@playwright/test";

/**
 * Production/release smoke suite -- separate from the unit tests
 * (`npm test`, `node:test`, hermetic, no network). This suite talks to a
 * real, running instance of the app over the network and is invoked
 * explicitly (`npm run test:e2e`), never as part of `npm test` or CI's
 * `lint-test-build`.
 *
 * SMOKE_BASE_URL is required, not defaulted -- deliberately. A suite
 * whose whole purpose is production verification must never silently
 * decide on its own whether "no config" means "run against prod" or
 * "run against nothing." Whoever runs it says explicitly where it
 * points:
 *
 *   SMOKE_BASE_URL=https://crm.aibuildpros.com npm run test:e2e   # real prod, read-only checks only
 *   SMOKE_BASE_URL=http://localhost:3000 npm run test:e2e         # local build
 *
 * See e2e/README.md for the full matrix of what this suite covers,
 * what still needs a human, and why.
 */
const baseURL = process.env.SMOKE_BASE_URL;
if (!baseURL) {
  throw new Error(
    "SMOKE_BASE_URL is required -- e.g. SMOKE_BASE_URL=https://crm.aibuildpros.com npm run test:e2e. " +
      "See e2e/README.md."
  );
}

export default defineConfig({
  testDir: "./",
  timeout: 30_000,
  // Every test here talks to a real server over the network -- 1 retry
  // absorbs a flaky connection without masking a real failure (2+ would
  // start hiding real ones).
  retries: 1,
  reporter: [["list"], ["json", { outputFile: "e2e/results.json" }]],
  use: {
    baseURL,
    // Fake camera/mic/screen-share devices so any spec that touches
    // getUserMedia/getDisplayMedia doesn't hang waiting on a real OS
    // permission prompt that headless Chromium can't show. Documented
    // limitation in twilio-and-screenshare.spec.ts: getDisplayMedia
    // resolves fine under these flags in this environment;
    // getUserMedia does not (verified, not assumed -- see that file).
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
    trace: "retain-on-failure",
  },
});
