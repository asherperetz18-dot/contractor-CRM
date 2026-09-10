import { test as base, expect, type Page } from "@playwright/test";

export type CspViolation = {
  disposition: "enforce" | "report";
  violatedDirective: string;
  blockedURI: string;
  sourceFile: string;
  lineNumber: number;
};

export type ConsoleEntry = { type: string; text: string };

/**
 * Every page-based spec needs the same two things tracked: console
 * output and CSP violations (the browser fires the same
 * `securitypolicyviolation` event for both the enforcing policy and the
 * Report-Only one, distinguished only by `event.disposition`).
 *
 * These override the base `page` fixture itself rather than being
 * separate opt-in fixtures a test can forget to destructure. That
 * distinction is not cosmetic: Playwright only initializes a fixture a
 * test actually asks for in its parameter list, so an earlier version
 * of this file (separate `consoleEntries`/`cspViolations` fixtures)
 * silently never installed the violation listener on any test that
 * only destructured `page` -- every "0 violations" result from those
 * tests was a false negative from a listener that was never wired up,
 * not a real clean page. Caught by manually reproducing the exact same
 * page load outside this fixture and finding 11 real violations where
 * the suite had reported zero. Overriding `page` directly means every
 * test gets both trackers automatically, with nothing to remember.
 */
export const test = base.extend<{
  consoleEntries: ConsoleEntry[];
  cspViolations: CspViolation[];
}>({
  consoleEntries: [
    async ({ page }, use) => {
      const entries: ConsoleEntry[] = [];
      page.on("console", (msg) => entries.push({ type: msg.type(), text: msg.text() }));
      page.on("pageerror", (err) => entries.push({ type: "pageerror", text: err.message }));
      await use(entries);
    },
    { auto: true },
  ],

  cspViolations: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        window.addEventListener("securitypolicyviolation", (e) => {
          const w = window as unknown as { __cspViolations?: unknown[] };
          w.__cspViolations = w.__cspViolations || [];
          w.__cspViolations.push({
            disposition: e.disposition,
            violatedDirective: e.violatedDirective,
            blockedURI: e.blockedURI,
            sourceFile: e.sourceFile,
            lineNumber: e.lineNumber,
          });
        });
      });
      await use([]);
    },
    { auto: true },
  ],
});

/** Pull whatever CSP violations the page recorded via the init script above. */
export async function collectCspViolations(page: Page): Promise<CspViolation[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __cspViolations?: CspViolation[] };
    return w.__cspViolations ?? [];
  });
}

/**
 * Console noise this suite doesn't treat as a failure -- browser/
 * extension chatter that has nothing to do with this app's own code,
 * or Next.js dev-only messages that a production run wouldn't emit
 * anyway. Anything else logged as `error` fails the test.
 */
const IGNORED_CONSOLE_PATTERNS = [/Download the React DevTools/i];

export function unexpectedConsoleErrors(entries: ConsoleEntry[]): ConsoleEntry[] {
  return entries.filter(
    (e) =>
      (e.type === "error" || e.type === "pageerror") &&
      !IGNORED_CONSOLE_PATTERNS.some((p) => p.test(e.text))
  );
}

export { expect };
