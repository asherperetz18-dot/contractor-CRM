import { test } from "node:test";
import assert from "node:assert/strict";
import { maskPhone, pickSafeFields, safeTwilioError, safeUser, scrubForbiddenKeys } from "./redact.ts";

/**
 * Every one of these is a privacy boundary: what reaches Sentry/logs must
 * never carry a full phone number, a secret-shaped key, or an arbitrary
 * object a caller forgot to filter. Test the boundary, not the happy path.
 */

test("maskPhone keeps enough to recognise, never the whole number", () => {
  assert.equal(maskPhone("+17144035570"), "+1••••••5570");
  assert.equal(maskPhone(""), "");
  assert.equal(maskPhone(null), "");
  assert.equal(maskPhone(undefined), "");
  // Too short to safely show a head and a tail without just repeating the
  // number back -- mask it entirely rather than leak it.
  assert.equal(maskPhone("123"), "•••");
});

test("pickSafeFields only copies keys on the allowlist, nothing else", () => {
  const source = { to: "+1", authorization: "Bearer x", note: "hi" };
  const picked = pickSafeFields(source, ["to", "note"]);
  assert.deepEqual(picked, { to: "+1", note: "hi" });
  assert.equal("authorization" in picked, false);
});

test("pickSafeFields skips keys the source doesn't actually have", () => {
  const source = { to: "+1" };
  const picked = pickSafeFields(source as Record<string, unknown>, ["to", "missing"]);
  assert.deepEqual(picked, { to: "+1" });
});

test("scrubForbiddenKeys drops anything secret-shaped by key name, case-insensitively", () => {
  const dirty = {
    callSid: "CA123",
    Authorization: "Bearer abc",
    authToken: "shh",
    apiKeySecret: "shh",
    Cookie: "session=abc",
    password: "hunter2",
    safeField: "keep me",
  };
  const clean = scrubForbiddenKeys(dirty);
  assert.deepEqual(clean, { callSid: "CA123", safeField: "keep me" });
});

test("safeUser returns only userId/companyId/role, never name or email", () => {
  const raw = {
    id: "user-1",
    company_id: "co-1",
    role: "Office",
    email: "bar@aibuildpros.com",
    full_name: "Bar Aloush",
  };
  assert.deepEqual(safeUser(raw), { userId: "user-1", companyId: "co-1", role: "Office" });
});

test("safeUser returns undefined when the essentials are missing", () => {
  assert.equal(safeUser(null), undefined);
  assert.equal(safeUser({ id: "user-1" }), undefined);
});

test("safeTwilioError extracts only the diagnostic fields, unwrapping .twilioError", () => {
  const err = {
    message: "General Error",
    code: 31000,
    twilioError: {
      code: 31000,
      message: "General Error",
      causes: ["Media negotiation failed", "Network unavailable"],
      solutions: ["Check network connectivity"],
      authToken: "should-never-appear",
    },
  };
  assert.deepEqual(safeTwilioError(err), {
    code: 31000,
    message: "General Error",
    causes: ["Media negotiation failed", "Network unavailable"],
    solutions: ["Check network connectivity"],
  });
});

test("safeTwilioError degrades gracefully for a plain Error with no twilioError", () => {
  const err = new Error("boom") as Error & { code?: number };
  err.code = 20104;
  assert.deepEqual(safeTwilioError(err), { code: 20104, message: "boom" });
});
