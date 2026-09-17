import { test } from "node:test";
import assert from "node:assert/strict";
import { portalLoginNotice } from "./login-notice.ts";

/**
 * A dead sign-in link used to dump the visitor on the plain login form
 * with no explanation -- the ?error= the verify route sent was simply
 * dropped. The notice is what turns "my link doesn't work" from a phone
 * call to the office into typing an email in the form right below it.
 */

test("no error param means no notice", () => {
  assert.equal(portalLoginNotice(undefined), null);
  assert.equal(portalLoginNotice(null), null);
  assert.equal(portalLoginNotice(""), null);
});

test("the verify route's own 'missing' code reads as words, not a code", () => {
  const n = portalLoginNotice("missing");
  assert.ok(n);
  assert.equal(n.message, "That sign-in link didn't work.");
  assert.match(n.hint, /email below/i);
});

test("beginLogin's messages pass through verbatim, with the recovery hint attached", () => {
  const used = portalLoginNotice("This sign-in link has already been used.");
  assert.ok(used);
  assert.equal(used.message, "This sign-in link has already been used.");
  assert.match(used.hint, /fresh link|new link/i);

  const expired = portalLoginNotice("This sign-in link has expired.");
  assert.ok(expired);
  assert.equal(expired.message, "This sign-in link has expired.");
});
