import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QB_TOKEN_URL,
  exchangeQuickBooksCode,
  needsRefresh,
  qbApiBase,
  quickbooksAuthorizeUrl,
  quickbooksCredentials,
  refreshQuickBooksTokens,
} from "./oauth.ts";
import { accountChoices, costCategories, parseQbAccounts, suggestPaymentMatch } from "./accounts.ts";

/**
 * QuickBooks, step 1 (DECISIONS #171): each company connects its own
 * QuickBooks Online through Intuit's sign-in, and matches its "paid from"
 * accounts and cost categories to QuickBooks accounts. Nothing is written
 * to QuickBooks yet: the CRM only reads the company's name and its list
 * of accounts. The login it's given is kept encrypted, on the server.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const creds = { clientId: "abc", clientSecret: "shh", environment: "sandbox" as const };
const NOW = new Date("2026-10-08T15:00:00Z");

test("the CRM's Intuit app comes from the environment; sandbox until it says production", () => {
  assert.equal(quickbooksCredentials({}), null);
  assert.equal(quickbooksCredentials({ QUICKBOOKS_CLIENT_ID: "abc" }), null);
  assert.deepEqual(quickbooksCredentials({ QUICKBOOKS_CLIENT_ID: "abc", QUICKBOOKS_CLIENT_SECRET: "shh" }), creds);
  assert.equal(
    quickbooksCredentials({ QUICKBOOKS_CLIENT_ID: "abc", QUICKBOOKS_CLIENT_SECRET: "shh", QUICKBOOKS_ENVIRONMENT: "production" })
      ?.environment,
    "production"
  );
  assert.equal(qbApiBase("sandbox"), "https://sandbox-quickbooks.api.intuit.com");
  assert.equal(qbApiBase("production"), "https://quickbooks.api.intuit.com");
});

test("the sign-in goes to Intuit, for the accounting scope, with our state", () => {
  const url = new URL(quickbooksAuthorizeUrl({ clientId: "abc", redirectUri: "https://crm.example.com/cb", state: "s1" }));
  assert.equal(url.origin + url.pathname, "https://appcenter.intuit.com/connect/oauth2");
  assert.equal(url.searchParams.get("client_id"), "abc");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "com.intuit.quickbooks.accounting");
  assert.equal(url.searchParams.get("redirect_uri"), "https://crm.example.com/cb");
  assert.equal(url.searchParams.get("state"), "s1");
});

test("the code is traded for tokens with the app's own login, and their lifetimes kept", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(
      JSON.stringify({
        token_type: "bearer",
        access_token: "AT",
        refresh_token: "RT",
        expires_in: 3600,
        x_refresh_token_expires_in: 8726400,
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
  const res = await exchangeQuickBooksCode({ fetchImpl, creds, code: "C", redirectUri: "https://crm.example.com/cb", now: NOW });
  assert.ok("tokens" in res);
  assert.deepEqual(res.tokens, {
    accessToken: "AT",
    refreshToken: "RT",
    accessExpiresAt: "2026-10-08T16:00:00.000Z",
    refreshExpiresAt: new Date(NOW.getTime() + 8726400 * 1000).toISOString(),
  });
  assert.equal(seen!.url, QB_TOKEN_URL);
  assert.equal(seen!.init.method, "POST");
  const headers = seen!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Basic ${Buffer.from("abc:shh").toString("base64")}`);
  const body = new URLSearchParams(String(seen!.init.body));
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "C");
  assert.equal(body.get("redirect_uri"), "https://crm.example.com/cb");
});

test("a refresh keeps the new refresh token; one Intuit refuses means connect again", async () => {
  const ok = (async () =>
    new Response(JSON.stringify({ access_token: "AT2", refresh_token: "RT2", expires_in: 3600, x_refresh_token_expires_in: 8726400 }), {
      status: 200,
    })) as unknown as typeof fetch;
  const fresh = await refreshQuickBooksTokens({ fetchImpl: ok, creds, refreshToken: "RT", now: NOW });
  assert.ok("tokens" in fresh && fresh.tokens.refreshToken === "RT2");

  const refused = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
  const gone = await refreshQuickBooksTokens({ fetchImpl: refused, creds, refreshToken: "RT", now: NOW });
  assert.ok("error" in gone && gone.reconnect === true);

  const down = (async () => new Response("oops", { status: 503 })) as unknown as typeof fetch;
  const later = await refreshQuickBooksTokens({ fetchImpl: down, creds, refreshToken: "RT", now: NOW });
  assert.ok("error" in later && later.reconnect === false);
});

test("an access token is refreshed five minutes before it runs out", () => {
  assert.equal(needsRefresh("2026-10-08T15:10:00Z", NOW), false);
  assert.equal(needsRefresh("2026-10-08T15:04:00Z", NOW), true);
  assert.equal(needsRefresh(null, NOW), true);
});

const QUERY = {
  QueryResponse: {
    Account: [
      { Id: "35", Name: "Chase Business Checking", AccountType: "Bank", Active: true },
      { Id: "41", Name: "American Express", AccountType: "Credit Card", Active: true },
      { Id: "42", Name: "Home Depot 4417", AccountType: "Credit Card", Active: true },
      { Id: "60", Name: "Job Supplies", AccountType: "Cost of Goods Sold", Active: true },
      { Id: "61", Name: "Merchant Fees", AccountType: "Expense", Active: true },
      { Id: "70", Name: "Old Savings", AccountType: "Bank", Active: false },
      { Id: "80", Name: "Sales", AccountType: "Income", Active: true },
    ],
  },
};

test("QuickBooks' accounts: the paid-from ones and the expense ones", () => {
  const accounts = parseQbAccounts(QUERY);
  assert.equal(accounts.length, 6);
  assert.deepEqual(accountChoices(accounts, "paid_from").map((a) => a.id), ["41", "35", "42"]);
  assert.deepEqual(accountChoices(accounts, "expense").map((a) => a.id), ["60", "61"]);
  assert.deepEqual(parseQbAccounts({}), []);
});

test("a paid-from account is matched for you only when one QuickBooks account clearly fits", () => {
  const accounts = parseQbAccounts(QUERY);
  assert.equal(suggestPaymentMatch({ name: "chase business  checking", kind: "bank", last4: null }, accounts), "35");
  assert.equal(suggestPaymentMatch({ name: "Amex", kind: "credit_card", last4: null }, accounts), null);
  assert.equal(suggestPaymentMatch({ name: "Home Depot card", kind: "credit_card", last4: "4417" }, accounts), "42");
  // A card is never matched to a bank account, whatever the name.
  assert.equal(suggestPaymentMatch({ name: "Chase Business Checking", kind: "credit_card", last4: null }, accounts), null);
});

test("cost categories as the company uses them, each once", () => {
  assert.deepEqual(costCategories(["Materials", " materials ", null, "", "Permits", "Financing fee"]), [
    "Financing fee",
    "Materials",
    "Permits",
  ]);
});

test("0221 keeps the login where no CRM user can read it", () => {
  const sql = source("../../../supabase/migrations/0221_quickbooks_connection.sql");
  assert.match(sql, /create table if not exists public\.quickbooks_connections/);
  assert.match(sql, /access_token_enc text/);
  assert.match(sql, /refresh_token_enc text/);
  assert.match(sql, /alter table public\.quickbooks_connections enable row level security;/);
  assert.match(sql, /revoke all on public\.quickbooks_connections from anon, authenticated;/);
  assert.match(sql, /create table if not exists public\.quickbooks_expense_accounts/);
  assert.match(sql, /select public\.apply_billing_lock_policies\(\);/);
  const backup = source("../backup-scope.ts");
  assert.match(backup, /"quickbooks_expense_accounts"/);
  assert.match(backup, /quickbooks_connections:/);
  assert.match(source("../schema-drift.ts"), /0221_quickbooks_connection\.sql/);
});

test("connecting: Office or Admin, our state back, the login encrypted", () => {
  const start = source("../../app/api/oauth/quickbooks/authorize/route.ts");
  assert.match(start, /isAdminRole\(profile\)/);
  assert.match(start, /quickbooksAuthorizeUrl\(/);
  const back = source("../../app/api/oauth/quickbooks/callback/route.ts");
  assert.match(back, /state !== expectedState/);
  assert.match(back, /oauthTargetAllowed\(/);
  assert.match(back, /encryptSecret\(/);
  assert.doesNotMatch(back, /access_token: tokens/);
  // The settings screen is never handed the login.
  const actions = source("../actions/quickbooks.ts");
  assert.doesNotMatch(actions, /select\("\*"\)/);
  assert.doesNotMatch(source("../../app/(app)/settings/quickbooks/quickbooks-view.tsx"), /token/i);
});
