#!/usr/bin/env node
// The App Store Connect API calls the iPhone workflows make (DECISIONS #171).
// No dependencies: Node signs the token itself. Reads the API key from the
// ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY environment variables and never
// prints any of them.
//
//   create-certificate --csr <file.pem> --out <file.cer>
//       Creates an Apple Distribution certificate from a CSR made on the
//       runner. Prints its id, serial and expiry (all public).
//   provisioning-profile --bundle-id <id> --cert-serial <hex> --name <name> --out <file>
//       Reuses the App Store profile with that name if it is active, is for
//       the app and carries the certificate. Otherwise replaces it.

import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const API = "https://api.appstoreconnect.apple.com/v1";

/** A token for the App Store Connect API. Apple refuses any over 20 minutes. */
export function makeToken({ keyId, issuerId, privateKey, now = Math.floor(Date.now() / 1000) }) {
  const part = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const header = part({ alg: "ES256", kid: keyId, typ: "JWT" });
  const payload = part({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" });
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: createPrivateKey(privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${signature.toString("base64url")}`;
}

/** openssl prints `serial=0A1B`; Apple answers `A1B`. */
export function normalizeSerial(serial) {
  return serial.replace(/^serial=/i, "").toUpperCase().replace(/^0+(?=.)/, "");
}

/**
 * Of the profiles named for this app, the one to sign with, and the ones to
 * delete so a new one can take the name. A profile is only good if it is
 * active, for this app, and carries this certificate.
 */
export function pickProfile(profiles, certificateId, bundleRecordId) {
  const keep =
    profiles.find(
      (p) =>
        p.attributes.profileState === "ACTIVE" &&
        p.relationships.bundleId.data?.id === bundleRecordId &&
        p.relationships.certificates.data.some((c) => c.id === certificateId)
    ) ?? null;
  return { keep, remove: keep ? [] : profiles.map((p) => p.id) };
}

function client() {
  const { ASC_KEY_ID: keyId, ASC_ISSUER_ID: issuerId, ASC_KEY: privateKey } = process.env;
  if (!keyId || !issuerId || !privateKey) {
    throw new Error("ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY must all be set.");
  }
  return async function call(method, path, body) {
    const token = makeToken({ keyId, issuerId, privateKey });
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const why = (json.errors ?? []).map((e) => `${e.title}: ${e.detail}`).join("; ");
      const hint =
        res.status === 401
          ? " Check APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID and that APP_STORE_CONNECT_KEY is the whole .p8 file."
          : res.status === 403
            ? " The API key's role doesn't allow this; it needs App Manager or Admin."
            : "";
      throw new Error(`${method} ${path.split("?")[0]} failed (${res.status}). ${why}${hint}`);
    }
    return json;
  };
}

async function createCertificate({ csr, out }) {
  const call = client();
  const { data } = await call("POST", "/certificates", {
    data: {
      type: "certificates",
      attributes: { certificateType: "DISTRIBUTION", csrContent: readFileSync(csr, "utf8") },
    },
  });
  writeFileSync(out, Buffer.from(data.attributes.certificateContent, "base64"));
  console.log(`Certificate ${data.id}, serial ${data.attributes.serialNumber}, expires ${data.attributes.expirationDate}`);
}

async function provisioningProfile({ "bundle-id": bundleId, "cert-serial": serial, name, out }) {
  const call = client();
  const certs = await call("GET", `/certificates?filter[serialNumber]=${normalizeSerial(serial)}`);
  const cert = certs.data.find((c) => normalizeSerial(c.attributes.serialNumber) === normalizeSerial(serial));
  if (!cert) {
    throw new Error(
      `Apple has no certificate with serial ${normalizeSerial(serial)}: it was revoked or never made. ` +
        `Run "iPhone signing certificate (create once)" with Replace ticked (docs/MOBILE_RELEASE.md).`
    );
  }
  const bundles = await call("GET", `/bundleIds?filter[identifier]=${encodeURIComponent(bundleId)}&filter[platform]=IOS`);
  const bundle = bundles.data.find((b) => b.attributes.identifier === bundleId);
  if (!bundle) throw new Error(`The bundle ID ${bundleId} isn't registered on developer.apple.com.`);

  const listed = await call(
    "GET",
    `/profiles?filter[name]=${encodeURIComponent(name)}&filter[profileType]=IOS_APP_STORE&include=bundleId,certificates&limit=200`
  );
  const { keep, remove } = pickProfile(listed.data, cert.id, bundle.id);
  let profile = keep;
  for (const id of remove) {
    await call("DELETE", `/profiles/${id}`);
    console.log(`Deleted profile ${id}: it couldn't sign with this certificate.`);
  }
  if (!profile) {
    ({ data: profile } = await call("POST", "/profiles", {
      data: {
        type: "profiles",
        attributes: { name, profileType: "IOS_APP_STORE" },
        relationships: {
          bundleId: { data: { type: "bundleIds", id: bundle.id } },
          certificates: { data: [{ type: "certificates", id: cert.id }] },
        },
      },
    }));
    console.log(`Created profile ${profile.id}.`);
  } else {
    console.log(`Reusing profile ${profile.id}.`);
  }
  writeFileSync(out, Buffer.from(profile.attributes.profileContent, "base64"));
}

const commands = { "create-certificate": createCertificate, "provisioning-profile": provisioningProfile };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      csr: { type: "string" },
      out: { type: "string" },
      "bundle-id": { type: "string" },
      "cert-serial": { type: "string" },
      name: { type: "string" },
    },
  });
  if (!commands[command]) {
    console.error(`Unknown command "${command}". Use: ${Object.keys(commands).join(", ")}.`);
    process.exit(2);
  }
  commands[command](values).catch((err) => {
    console.error(`::error::${err.message}`);
    process.exit(1);
  });
}
