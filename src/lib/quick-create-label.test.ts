import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The Quick Create button carries two labels: "+ Quick Create", and a
// bare "+" for phones. Only the phone rule mentioned the short one, so
// on every wider screen both showed and the button read "+ Quick Create+".
test("the short '+' label is hidden unless the phone rule shows it", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const base = css.match(/\n\.qc-label-short\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(base, /display:\s*none/, "a top-level .qc-label-short rule hides it");
});
