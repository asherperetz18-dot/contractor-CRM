import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The Daily Brief opens from the top bar on any page, and its tiles link
 * into the Schedule, Call Reports and Text Reports on a period. Tapped
 * while the brief sits over that very page, the link changed the address
 * under a report that keeps its period in state: the Schedule and Text
 * Reports pushed the address straight back to their old period, and Call
 * Reports loaded the new calls under its old period's name. Each now
 * follows an address it didn't ask for (adjusting state from a prop,
 * during render, as React advises), the way Appointment Reports does.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the Schedule follows a link that arrives while it's open", () => {
  const view = source("../app/(app)/schedule/schedule-list.tsx");
  assert.match(
    view,
    /if \(seenQs !== loadedQs\) \{\s*setSeenQs\(loadedQs\);\s*if \(loadedQs !== wantedQs\) \{\s*setRange\(query\.range\);\s*setCustomFrom\(query\.from \?\? ""\);\s*setCustomTo\(query\.to \?\? ""\);\s*setRepFilter\(query\.rep \?\? "All"\);\s*setLimit\(query\.limit\);/
  );
});

test("Text Reports follows a link that arrives while it's open", () => {
  const view = source("../app/(app)/text-reports/text-reports-view.tsx");
  assert.match(
    view,
    /if \(seenQs !== loadedQs\) \{\s*setSeenQs\(loadedQs\);\s*if \(loadedQs !== wantedQs\) setRange\(textReportRange\(query\)\);/
  );
});

test("Call Reports names the period a link brought, not the last one picked", () => {
  // Its days too: the brief's week tile lands on a custom range, and the
  // From / To boxes must show that week, not the dates last typed.
  const view = source("../app/(app)/call-reports/call-reports-view.tsx");
  assert.match(
    view,
    /if \(seenLink !== link\) \{\s*setSeenLink\(link\);\s*setRangeKey\(initialRange\);\s*setCustomFrom\(initialFrom\);\s*setCustomTo\(initialTo\);/
  );
});

test("each report asks for its period by the shared rule, remembering what it asked for", () => {
  // Following an address it didn't ask for must not swallow its own
  // stale request: click 7 days, then 30 again before the 7 arrive, and
  // it used to end on the 7 (report-address.ts replays this).
  for (const path of [
    "../app/(app)/schedule/schedule-list.tsx",
    "../app/(app)/text-reports/text-reports-view.tsx",
    "../app/(app)/appointment-reports/appointment-reports-view.tsx",
  ]) {
    const view = source(path);
    assert.match(view, /const asked = useRef\(loadedQs\);/, path);
    assert.match(view, /const loadedBefore = useRef\(loadedQs\);/, path);
    assert.match(
      view,
      /const followed = loadedQs !== loadedBefore\.current;\s*loadedBefore\.current = loadedQs;\s*const ask = requestsAddress\(\{\s*wanted: wantedQs,\s*loaded: loadedQs,\s*sent: asked\.current,\s*pending: windowPending,\s*followed,\s*\}\);\s*asked\.current = wantedQs;\s*if \(ask\)/,
      path
    );
    assert.match(view, /\}, \[wantedQs, loadedQs, windowPending, (typing, )?router\]\);/, path);
  }
});
