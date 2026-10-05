import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_NOTES } from "./release-notes.ts";

/**
 * Every company sees the same examples, hints and "What's new" notes, so
 * none of them may carry one subscriber's real details: its name,
 * address, phone, email or licence, or a real person's (DECISIONS #116).
 * Examples use the same made-up company as the tutorials: Summit
 * Builders Co, 555-01xx phone numbers, @example.com addresses.
 */

const SRC = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

test("contract merge-field examples are made up, not a subscriber's or a customer's", () => {
  const merge = readFileSync(join(SRC, "lib/contracts/merge.ts"), "utf8");
  const examples = [...merge.matchAll(/example: "([^"]*)"/g)].map((m) => m[1]);
  assert.ok(examples.length >= 15, "every merge field has an example");
  const byToken = Object.fromEntries(
    [...merge.matchAll(/token: "([a-z_]+)"[^}]*example: "([^"]*)"/g)].map((m) => [m[1], m[2]])
  );
  assert.equal(byToken.company_name, "Summit Builders Co");
  assert.match(byToken.company_email, /@example\.com$/);
  assert.match(byToken.client_email, /@example\.com$/);
  for (const token of ["company_phone", "client_phone"]) {
    assert.match(byToken[token], /555-01\d\d/, `${token} is a 555-01xx number`);
  }
  for (const real of ["L.A. Home", "lahome", "Malibu", "Sherman Oaks", "1027193", "Natanel", "Peretz"]) {
    assert.ok(!merge.includes(real), `no "${real}" in the examples`);
  }
});

test("no real-looking phone number or subscriber address is left in the code or its tests", () => {
  // Numbers that were in comments, hints and test data. A real person's
  // number has no place in a public repository, even in a comment.
  const gone = [
    /818\D{0,2}300\D?8242/, /714\D{0,2}403\D?5570/, /424\D{0,2}768\D?2268/, /213\D{0,2}880\D?6622/,
    /310\D{0,2}697\D?6137/, /626\D{0,2}325\D?4475/, /323\D{0,2}806\D?7609/, /818\D{0,2}268\D?7398/,
    /818\D{0,2}651\D?1997/, /818\D{0,2}717\D?7714/, /646\D{0,2}930\D?4111/, /smarthvacsystem\.com/,
  ];
  const hits = sourceFiles(SRC)
    .filter((f) => gone.some((re) => re.test(readFileSync(f, "utf8"))))
    .map((f) => relative(SRC, f));
  assert.deepEqual(hits, []);
});

test("What's new never names a subscriber company or a person", () => {
  const names = /\b(La Home|L\.A\.? Home|Ca Pro|Smart Hvac|Smart HVAC|Plumbig|Romano|NationWide|Asher|Peretz)\b/;
  for (const note of RELEASE_NOTES) {
    for (const line of note.notes) assert.doesNotMatch(line, names, `${note.version}: ${line}`);
  }
});
