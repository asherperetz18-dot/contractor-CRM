import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A company client is named for the company on every screen, document
 * and alert -- its person is only the contact (src/lib/data/client-name.ts).
 *
 * That rule was broken in some thirty places at once, each gluing
 * first_name and last_name together by hand, so every company client
 * read as "Josh Martinez" on its estimate, contract, lists and reports
 * while its own card said "Coast to Coast". This test fails on any new
 * hand-built name. Use clientName() for who the client is, or
 * personName() where it really is the person (a greeting, a signer).
 */

const srcRoot = join(import.meta.dirname, "..");

/** Where joining the two fields by hand is the point. */
const ALLOWED = new Set([
  "lib/data/client-name.ts", // the one place the rule lives
  "lib/callrail-sync.ts", // parsing a raw web form payload, not a lead
]);

const HAND_BUILT = [
  /\[[^\]\n]*\bfirst_name\b[^\]\n]*\blast_name\b[^\]\n]*\]\s*\.filter\(Boolean\)/g,
  /\$\{[^}\n]*\bfirst_name\b[^}\n]*\}\s*\$\{[^}\n]*\blast_name\b/g,
  /\{[^}\n]*\bfirst_name\b\}\s*\{[^}\n]*\blast_name\b\}/g,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

export function handBuiltNames(src: string): number[] {
  const lines: number[] = [];
  for (const re of HAND_BUILT) {
    for (const m of src.matchAll(re)) lines.push(src.slice(0, m.index).split("\n").length);
  }
  return lines;
}

test("the detector catches each way a name gets glued together", () => {
  assert.equal(handBuiltNames('[l.first_name, l.last_name].filter(Boolean).join(" ")').length, 1);
  assert.equal(handBuiltNames("`${l.first_name ?? \"\"} ${l.last_name ?? \"\"}`").length, 1);
  assert.equal(handBuiltNames("<td>{lead.first_name} {lead.last_name}</td>").length, 1);
  assert.equal(handBuiltNames('.select("id, first_name, last_name")').length, 0);
});

test("no screen, document or alert builds a client's name by hand", () => {
  const offenders: string[] = [];
  for (const file of walk(srcRoot)) {
    const rel = relative(srcRoot, file).split("\\").join("/");
    if (ALLOWED.has(rel)) continue;
    for (const line of handBuiltNames(readFileSync(file, "utf8"))) offenders.push(`${rel}:${line}`);
  }
  assert.deepEqual(offenders, [], "use clientName() / personName() from @/lib/data/client-name");
});
