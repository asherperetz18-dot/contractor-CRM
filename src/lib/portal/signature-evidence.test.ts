import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveClientIp, collectSignatureEvidence } from "./signature-evidence.ts";

function headersFrom(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

test("prefers x-vercel-forwarded-for over every other header", () => {
  const head = headersFrom({
    "x-vercel-forwarded-for": "203.0.113.5",
    "x-forwarded-for": "198.51.100.9",
    "x-real-ip": "192.0.2.1",
  });
  assert.equal(resolveClientIp(head), "203.0.113.5");
});

test("falls back to x-forwarded-for and keeps only the first (client) hop", () => {
  const head = headersFrom({
    "x-forwarded-for": "198.51.100.9, 70.41.3.18, 150.172.238.178",
  });
  assert.equal(resolveClientIp(head), "198.51.100.9");
});

test("trims whitespace around a forwarded-for chain", () => {
  const head = headersFrom({ "x-forwarded-for": "  198.51.100.9  ,  70.41.3.18 " });
  assert.equal(resolveClientIp(head), "198.51.100.9");
});

test("falls back to x-real-ip when neither forwarded-for header is present", () => {
  const head = headersFrom({ "x-real-ip": "192.0.2.1" });
  assert.equal(resolveClientIp(head), "192.0.2.1");
});

test("skips a header that is present but empty and falls through to the next", () => {
  const head = headersFrom({ "x-vercel-forwarded-for": "", "x-real-ip": "192.0.2.1" });
  assert.equal(resolveClientIp(head), "192.0.2.1");
});

test("returns null rather than fabricating an IP when nothing is present", () => {
  const head = headersFrom({});
  assert.equal(resolveClientIp(head), null);
});

test("collectSignatureEvidence captures the user agent from the request headers", () => {
  const head = headersFrom({ "user-agent": "Mozilla/5.0 (test)" });
  const evidence = collectSignatureEvidence(head, "2026-08-12T00:00:00.000Z");
  assert.equal(evidence.userAgent, "Mozilla/5.0 (test)");
});

test("collectSignatureEvidence reports a null user agent rather than an empty string when absent", () => {
  const head = headersFrom({});
  const evidence = collectSignatureEvidence(head, "2026-08-12T00:00:00.000Z");
  assert.equal(evidence.userAgent, null);
});

test("collectSignatureEvidence threads the caller's signedAt through unchanged", () => {
  const head = headersFrom({});
  const evidence = collectSignatureEvidence(head, "2026-08-12T00:00:00.000Z");
  assert.equal(evidence.signedAt, "2026-08-12T00:00:00.000Z");
});

test("collectSignatureEvidence uses the same IP resolution as resolveClientIp", () => {
  const head = headersFrom({
    "x-vercel-forwarded-for": "203.0.113.5",
    "x-forwarded-for": "198.51.100.9",
  });
  const evidence = collectSignatureEvidence(head, "2026-08-12T00:00:00.000Z");
  assert.equal(evidence.ip, "203.0.113.5");
});
