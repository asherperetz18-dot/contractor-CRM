import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import {
  makeToken,
  normalizeSerial,
  pickProfile,
} from "../../../mobile/release/app-store-connect.mjs";

/**
 * The iPhone release workflow talks to the App Store Connect API through
 * mobile/release/app-store-connect.mjs (DECISIONS #171): it signs a
 * short-lived token with the App Manager key, and on each release reuses
 * the App Store provisioning profile or replaces one that no longer fits.
 * A wrong token fails every call with a bare 401, and a wrong profile pick
 * fails the archive an hour later, so both are pinned here.
 */

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function decode(part: string) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

test("the token is an ES256 JWT Apple accepts: kid header, issuer, audience, under 20 minutes", () => {
  const token = makeToken({ keyId: "ABC123", issuerId: "issuer-uuid", privateKey: pem, now: 1_000_000 });
  const [header, payload, signature] = token.split(".");
  assert.deepEqual(decode(header), { alg: "ES256", kid: "ABC123", typ: "JWT" });
  assert.deepEqual(decode(payload), {
    iss: "issuer-uuid",
    iat: 1_000_000,
    exp: 1_000_000 + 15 * 60,
    aud: "appstoreconnect-v1",
  });
  const ok = verify(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    { key: createPublicKey(pem), dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url")
  );
  assert.ok(ok, "signature verifies with the key's public half, in JOSE (r||s) form");
});

test("a serial from openssl and one from Apple compare equal", () => {
  assert.equal(normalizeSerial("serial=0A1B2C"), "A1B2C");
  assert.equal(normalizeSerial("0a1b2c"), "A1B2C");
  assert.equal(normalizeSerial("A1B2C"), "A1B2C");
});

const profile = (id: string, state: string, certs: string[], bundle = "B1") => ({
  id,
  type: "profiles",
  attributes: { name: "AI Build Pros CRM App Store", profileState: state },
  relationships: {
    bundleId: { data: { type: "bundleIds", id: bundle } },
    certificates: { data: certs.map((c) => ({ type: "certificates", id: c })) },
  },
});

test("an active profile for this app that carries the certificate is reused as is", () => {
  const keep = profile("P1", "ACTIVE", ["C1"]);
  assert.deepEqual(pickProfile([keep], "C1", "B1"), { keep, remove: [] });
});

test("profiles that can't sign with this certificate are replaced, never kept", () => {
  const profiles = [
    profile("P1", "INVALID", ["C1"]),
    profile("P2", "ACTIVE", ["OLD"]),
    profile("P3", "EXPIRED", ["C1"]),
    profile("P4", "ACTIVE", ["C1"], "OTHER-APP"),
  ];
  assert.deepEqual(pickProfile(profiles, "C1", "B1"), { keep: null, remove: ["P1", "P2", "P3", "P4"] });
});

test("with a good profile present, the others are left alone", () => {
  const good = profile("P2", "ACTIVE", ["C1"]);
  const result = pickProfile([profile("P1", "INVALID", ["C1"]), good], "C1", "B1");
  assert.deepEqual(result, { keep: good, remove: [] });
});
