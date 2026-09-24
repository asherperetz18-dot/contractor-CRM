import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  META_LOGIN_SCOPES,
  metaAuthorizeUrl,
  metaLoginCredentials,
  pagesFromAccounts,
  isMetaMigrationMissing,
  parsePendingSignIn,
  verifyMetaSignature,
  webhookSignatureCheck,
} from "./facebook-login.ts";

/**
 * "Connect with Facebook" replaces five hand-copied values with one
 * sign-in. What can go wrong without a network is pinned here: which
 * Pages a sign-in offers, and -- the security edge -- which secret a
 * lead webhook has to be signed with before a lead is created.
 */

test("credentials need both the app id and secret", () => {
  assert.equal(metaLoginCredentials({}), null);
  assert.equal(metaLoginCredentials({ META_APP_ID: "123" }), null);
  assert.equal(metaLoginCredentials({ META_APP_SECRET: "s" }), null);
  assert.deepEqual(metaLoginCredentials({ META_APP_ID: "123", META_APP_SECRET: "s" }), {
    appId: "123",
    appSecret: "s",
    configId: null,
  });
  assert.deepEqual(
    metaLoginCredentials({ META_APP_ID: "123", META_APP_SECRET: "s", META_LOGIN_CONFIG_ID: "cfg" }),
    { appId: "123", appSecret: "s", configId: "cfg" }
  );
});

test("the sign-in URL asks for the lead permissions and carries the state", () => {
  const url = new URL(
    metaAuthorizeUrl({ appId: "123", configId: null, redirectUri: "https://crm.test/cb", state: "abc" })
  );
  assert.equal(url.hostname, "www.facebook.com");
  assert.match(url.pathname, /^\/v\d+\.\d+\/dialog\/oauth$/);
  assert.equal(url.searchParams.get("client_id"), "123");
  assert.equal(url.searchParams.get("redirect_uri"), "https://crm.test/cb");
  assert.equal(url.searchParams.get("state"), "abc");
  assert.equal(url.searchParams.get("response_type"), "code");
  const scopes = url.searchParams.get("scope")!.split(",");
  for (const s of ["leads_retrieval", "pages_show_list", "pages_manage_metadata", "business_management"]) {
    assert.ok(scopes.includes(s), `missing ${s}`);
  }
  assert.deepEqual(scopes, META_LOGIN_SCOPES);
});

test("a Facebook Login for Business configuration replaces the scope list", () => {
  const url = new URL(
    metaAuthorizeUrl({ appId: "123", configId: "cfg", redirectUri: "https://crm.test/cb", state: "abc" })
  );
  assert.equal(url.searchParams.get("config_id"), "cfg");
  assert.equal(url.searchParams.get("scope"), null);
});

test("Pages come back by name, without the ones Facebook gave no token for", () => {
  const pages = pagesFromAccounts({
    data: [
      { id: "2", name: "Zeta Roofing", access_token: "t2" },
      { id: "1", name: "Acme Remodeling", access_token: "t1" },
      { id: "3", name: "No Token Page" },
      { name: "No Id", access_token: "t4" },
    ],
  });
  assert.deepEqual(pages, [
    { id: "1", name: "Acme Remodeling", accessToken: "t1" },
    { id: "2", name: "Zeta Roofing", accessToken: "t2" },
  ]);
});

test("an unexpected accounts answer is no Pages, not a crash", () => {
  assert.deepEqual(pagesFromAccounts(null), []);
  assert.deepEqual(pagesFromAccounts({ error: { message: "nope" } }), []);
  assert.deepEqual(pagesFromAccounts({ data: [{ id: 5, access_token: "t" }] }), [
    { id: "5", name: "Page 5", accessToken: "t" },
  ]);
});

test("a Page connected with Facebook is checked with the CRM's own app secret", () => {
  assert.deepEqual(
    webhookSignatureCheck({ meta_connected_via: "facebook_login", meta_app_secret: null }, "platform"),
    { kind: "verify", secret: "platform" }
  );
  // A leftover manual secret never replaces the platform one: Meta signs
  // with the app the Page is subscribed to, which is the CRM's.
  assert.deepEqual(
    webhookSignatureCheck({ meta_connected_via: "facebook_login", meta_app_secret: "old" }, "platform"),
    { kind: "verify", secret: "platform" }
  );
});

test("a Facebook-connected Page with no secret on the deployment is refused, never waved through", () => {
  assert.deepEqual(
    webhookSignatureCheck({ meta_connected_via: "facebook_login", meta_app_secret: null }, undefined),
    { kind: "reject" }
  );
});

test("a manually set-up Page keeps its own secret, and stays unchecked without one as before", () => {
  assert.deepEqual(webhookSignatureCheck({ meta_connected_via: null, meta_app_secret: "own" }, "platform"), {
    kind: "verify",
    secret: "own",
  });
  assert.deepEqual(webhookSignatureCheck({ meta_connected_via: null, meta_app_secret: null }, "platform"), {
    kind: "skip",
  });
});

test("the signature must be the body's HMAC under the secret", () => {
  const body = '{"object":"page"}';
  const good = "sha256=" + crypto.createHmac("sha256", "s3cret").update(body).digest("hex");
  assert.equal(verifyMetaSignature(body, good, "s3cret"), true);
  assert.equal(verifyMetaSignature(body, good, "other"), false);
  assert.equal(verifyMetaSignature(body + " ", good, "s3cret"), false);
  assert.equal(verifyMetaSignature(body, null, "s3cret"), false);
  assert.equal(verifyMetaSignature(body, "sha256=short", "s3cret"), false);
});

test("a waiting sign-in is read back only when it names a company and a token", () => {
  assert.deepEqual(parsePendingSignIn(JSON.stringify({ company_id: "c1", token: "t" })), {
    companyId: "c1",
    userToken: "t",
  });
  assert.equal(parsePendingSignIn(undefined), null);
  assert.equal(parsePendingSignIn("not json"), null);
  assert.equal(parsePendingSignIn(JSON.stringify({ company_id: "c1" })), null);
  assert.equal(parsePendingSignIn(JSON.stringify({ token: "t" })), null);
});

test("a save against a database without migration 0178 is recognised, other errors are not", () => {
  assert.equal(isMetaMigrationMissing('column company_profile.meta_page_name does not exist'), true);
  assert.equal(
    isMetaMigrationMissing("Could not find the 'meta_connected_via' column of 'company_profile' in the schema cache"),
    true
  );
  assert.equal(isMetaMigrationMissing("permission denied for table company_profile"), false);
});
