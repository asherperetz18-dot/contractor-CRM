import { test } from "node:test";
import assert from "node:assert/strict";
import { LEGAL_FOOTER, withLegalFooter } from "./email-footer.ts";

test("html body gains the legal footer without losing its content", () => {
  const { html } = withLegalFooter("<div>Your estimate is ready.</div>", "Your estimate is ready.");
  assert.ok(html.startsWith("<div>Your estimate is ready.</div>"));
  assert.ok(html.includes(LEGAL_FOOTER));
});

test("plain-text body gains the legal footer on its own line at the end", () => {
  const { text } = withLegalFooter("<div>Hi</div>", "Hi");
  assert.ok(text.endsWith(LEGAL_FOOTER));
  assert.ok(text.startsWith("Hi\n"));
});

test("footer names the LLC, not the domain", () => {
  assert.equal(LEGAL_FOOTER, "© 2026 AI Build Pros LLC. All rights reserved.");
});
