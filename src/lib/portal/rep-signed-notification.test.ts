import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyRepOfSignature } from "./rep-signed-notification.ts";

const LINK = "https://example.com/estimates/est-1";

function neverCalled(label: string) {
  return async () => {
    throw new Error(`${label} should not have been called`);
  };
}

test("reports no_assigned_rep and never looks up a profile or sends mail", async () => {
  const result = await notifyRepOfSignature({
    assignedTo: null,
    lookupRep: neverCalled("lookupRep"),
    sendEmail: neverCalled("sendEmail"),
    docNumber: "EST-1001",
    kind: "estimate",
    link: LINK,
  });
  assert.deepEqual(result, { outcome: "no_assigned_rep" });
});

test("reports rep_profile_missing when the assigned profile can't be found", async () => {
  const result = await notifyRepOfSignature({
    assignedTo: "rep-1",
    lookupRep: async () => null,
    sendEmail: neverCalled("sendEmail"),
    docNumber: "EST-1001",
    kind: "estimate",
    link: LINK,
  });
  assert.deepEqual(result, { outcome: "rep_profile_missing" });
});

test("reports rep_email_missing for an assigned rep with no email on file", async () => {
  const result = await notifyRepOfSignature({
    assignedTo: "rep-1",
    lookupRep: async () => ({ email: null, name: "Jamie Rep" }),
    sendEmail: neverCalled("sendEmail"),
    docNumber: "EST-1001",
    kind: "estimate",
    link: LINK,
  });
  assert.deepEqual(result, { outcome: "rep_email_missing" });
});

test("reports send_failed when sendEmail resolves with an error instead of throwing", async () => {
  const result = await notifyRepOfSignature({
    assignedTo: "rep-1",
    lookupRep: async () => ({ email: "rep@example.com", name: "Jamie Rep" }),
    sendEmail: async () => ({ error: "Could not send the email (HTTP 422)." }),
    docNumber: "EST-1001",
    kind: "estimate",
    link: LINK,
  });
  assert.deepEqual(result, {
    outcome: "send_failed",
    error: "Could not send the email (HTTP 422).",
  });
});

test("reports sent and calls sendEmail with the rep's address once everything checks out", async () => {
  const calls: unknown[] = [];
  const result = await notifyRepOfSignature({
    assignedTo: "rep-1",
    lookupRep: async () => ({ email: "rep@example.com", name: "Jamie Rep" }),
    sendEmail: async (to, subject, html, text) => {
      calls.push({ to, subject, html, text });
      return { id: "email-123" };
    },
    docNumber: "EST-1001",
    kind: "estimate",
    link: LINK,
  });
  assert.deepEqual(result, { outcome: "sent" });
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { to: string }).to, "rep@example.com");
  assert.match((calls[0] as { subject: string }).subject, /EST-1001 was just signed/);
});

test("resolves rather than rejecting when sendEmail throws instead of returning { error }", async () => {
  // sendEmail's real implementation always resolves, never throws -- but
  // this is exactly the property that must hold regardless: a signature
  // has already been committed by the time this runs, so nothing in the
  // notification path may surface as a rejected promise the caller has to
  // treat as "the sign failed."
  const result = await notifyRepOfSignature({
    assignedTo: "rep-1",
    lookupRep: async () => ({ email: "rep@example.com", name: "Jamie Rep" }),
    sendEmail: async () => {
      throw new Error("network exploded");
    },
    docNumber: "EST-1001",
    kind: "estimate",
    link: LINK,
  });
  assert.equal(result.outcome, "error");
  assert.equal("error" in result ? result.error : undefined, "network exploded");
});

test("resolves rather than rejecting when the rep lookup itself throws", async () => {
  const result = await notifyRepOfSignature({
    assignedTo: "rep-1",
    lookupRep: async () => {
      throw new Error("db unreachable");
    },
    sendEmail: neverCalled("sendEmail"),
    docNumber: "EST-1001",
    kind: "estimate",
    link: LINK,
  });
  assert.equal(result.outcome, "error");
});

test("labels a change order and a completion certificate distinctly in the email body", async () => {
  const bodies: string[] = [];
  const capture = async (_to: string, _subject: string, _html: string, text: string) => {
    bodies.push(text);
    return { id: "ok" };
  };

  await notifyRepOfSignature({
    assignedTo: "rep-1",
    lookupRep: async () => ({ email: "rep@example.com", name: null }),
    sendEmail: capture,
    docNumber: "CO-1",
    kind: "change_order",
    link: LINK,
  });
  await notifyRepOfSignature({
    assignedTo: "rep-1",
    lookupRep: async () => ({ email: "rep@example.com", name: null }),
    sendEmail: capture,
    docNumber: "CERT-1",
    kind: "completion",
    link: LINK,
  });

  assert.match(bodies[0], /change order CO-1/);
  assert.match(bodies[1], /completion certificate CERT-1/);
});
