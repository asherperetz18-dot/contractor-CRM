import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { companyUrl } from "./open-in-company.ts";

/**
 * Switching company changes a cookie; a soft refresh then re-renders the
 * server parts but keeps everything the browser already holds -- above
 * all the dialer's Twilio device, which kept placing calls on the
 * previous company's account, so a Ca Pro Builder call rang the customer
 * from La Home Contractor's number. Every switch now ends in a full page
 * load (openInCompany), so nothing from the last company survives
 * (DECISIONS #105).
 */

test("the destination is an absolute address on this site", () => {
  assert.equal(companyUrl("/", "https://crm.example.com"), "https://crm.example.com/");
  assert.equal(companyUrl("/settings/twilio", "https://crm.example.com"), "https://crm.example.com/settings/twilio");
});

test("it can't be pointed off the site", () => {
  assert.equal(companyUrl("//evil.example.com/x", "https://crm.example.com"), "https://crm.example.com/");
  assert.equal(companyUrl("https://evil.example.com/", "https://crm.example.com"), "https://crm.example.com/");
});

const SRC = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".tsx") ? [path] : [];
  });
}

test("every company switch in the browser ends in a full page load", () => {
  const switchers = sourceFiles(SRC).filter((f) => /\b(switchCompany|createCompany)\(/.test(readFileSync(f, "utf8")));
  assert.ok(switchers.length >= 3, "expected the switcher, platform admin and billing-lock screens");
  const soft = switchers
    .filter((f) => !/openInCompany\(/.test(readFileSync(f, "utf8")))
    .map((f) => relative(SRC, f));
  assert.deepEqual(soft, []);
});
