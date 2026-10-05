import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SETUP_PROFILE_COLUMNS,
  setupFactsFromRow,
  setupHiddenCookie,
  setupItems,
  setupSummary,
  type SetupFacts,
  type SetupProfileRow,
} from "./setup-checklist.ts";

const NEW_COMPANY: SetupFacts = {
  phone: null,
  email: null,
  address: null,
  logoUrl: null,
  timezone: "Pacific",
  ownTwilio: false,
  ownStripe: false,
  defaultContract: false,
  team: 1,
};

const ALL_DONE: SetupFacts = {
  phone: "555-0100",
  email: "office@example.com",
  address: "1 Main St",
  logoUrl: "https://example.com/logo.png",
  timezone: "Mountain",
  ownTwilio: true,
  ownStripe: true,
  defaultContract: true,
  team: 3,
};

test("a brand-new company has all six steps to do, each linking to where it's done", () => {
  const items = setupItems(NEW_COMPANY);
  assert.deepEqual(
    items.map((i) => [i.key, i.href, i.done]),
    [
      ["details", "/settings/company-profile", false],
      ["logo", "/settings?card=logo", false],
      ["phone", "/settings/twilio", false],
      ["payments", "/settings/portal-payments", false],
      ["contract", "/settings/contracts", false],
      ["team", "/settings/users-roles", false],
    ]
  );
  assert.deepEqual(setupSummary(items), {
    done: 0,
    total: 6,
    missing: ["Details", "Logo", "Phone number", "Payments", "Contract", "Team"],
  });
});

test("a company with everything set up has nothing missing", () => {
  const items = setupItems(ALL_DONE);
  assert.ok(items.every((i) => i.done));
  assert.deepEqual(setupSummary(items), { done: 6, total: 6, missing: [] });
});

test("business details need all three of phone, email and address; blanks don't count", () => {
  const details = (f: Partial<SetupFacts>) => setupItems({ ...ALL_DONE, ...f }).find((i) => i.key === "details")!;
  assert.equal(details({}).done, true);
  assert.equal(details({ address: null }).done, false);
  assert.equal(details({ email: "   " }).done, false);
  assert.equal(details({ phone: "" }).done, false);
  // The time zone can't be told apart from the default, so it is named for checking, not counted.
  assert.match(details({ timezone: "Mountain" }).detail, /it's set to Mountain\./);
  assert.match(details({ timezone: null }).detail, /it's set to Pacific\./);
});

test("the team step counts the owner, so it needs one more person", () => {
  const team = (n: number) => setupItems({ ...NEW_COMPANY, team: n }).find((i) => i.key === "team")!.done;
  assert.equal(team(1), false);
  assert.equal(team(2), true);
});

const row = (r: Partial<SetupProfileRow>): SetupProfileRow => ({
  company_id: "c1",
  phone: null,
  email: null,
  address: null,
  logo_url: null,
  timezone: "Pacific",
  twilio_account_sid: null,
  twilio_auth_token_enc: null,
  twilio_phone_number: null,
  stripe_secret_key_enc: null,
  ...r,
});

test("its own number counts only with the account, token and number all saved -- the same test as texting itself", () => {
  const own = (r: Partial<SetupProfileRow>) => setupFactsFromRow(row(r), false, 1).ownTwilio;
  assert.equal(own({ twilio_account_sid: "AC1", twilio_auth_token_enc: "enc", twilio_phone_number: "+15550100" }), true);
  assert.equal(own({ twilio_account_sid: "AC1", twilio_phone_number: "+15550100" }), false);
  assert.equal(own({ twilio_auth_token_enc: "enc", twilio_phone_number: "+15550100" }), false);
  assert.equal(own({ twilio_account_sid: "AC1", twilio_auth_token_enc: "enc" }), false);
});

test("only whether a secret is saved leaves the profile row, never the secret", () => {
  const facts = setupFactsFromRow(
    row({ twilio_auth_token_enc: "ENC-TWILIO", stripe_secret_key_enc: "ENC-STRIPE" }),
    true,
    2
  );
  assert.equal(facts.ownStripe, true);
  assert.doesNotMatch(JSON.stringify(facts), /ENC-/);
  assert.doesNotMatch(JSON.stringify(setupItems(facts)), /ENC-/);
  // No profile row at all reads as nothing done, not as an error.
  assert.deepEqual(setupSummary(setupItems(setupFactsFromRow(null, false, 0))).done, 0);
});

test("the profile read names only the columns the checklist uses", () => {
  assert.deepEqual(SETUP_PROFILE_COLUMNS.split(",").map((c) => c.trim()).sort(), [
    "address",
    "company_id",
    "email",
    "logo_url",
    "phone",
    "stripe_secret_key_enc",
    "timezone",
    "twilio_account_sid",
    "twilio_auth_token_enc",
    "twilio_phone_number",
  ]);
});

test("hiding is per company, so hiding one company's list doesn't hide another's", () => {
  assert.notEqual(setupHiddenCookie("a"), setupHiddenCookie("b"));
  assert.match(setupHiddenCookie("0b7f-uuid"), /^[A-Za-z0-9_-]+$/); // a valid cookie name
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the Dashboard shows the checklist only to Office and Admin, until every step is done", () => {
  const page = source("../app/(app)/page.tsx");
  assert.match(page, /isAdminRole\(profile\)/);
  assert.match(page, /setupHiddenCookie\(companyId\)/);
  // The facts are read for the signed-in company, never one from the browser.
  assert.match(page, /getSetupFacts\(companyId\)/);
  assert.match(page, /const companyId = profile\?\.company_id/);
  assert.match(page, /setup\?\.some\(\(i\) => !i\.done\) && <SetupChecklist/);
});

test("the encrypted values are read on the server only, and never selected on the page", () => {
  const data = source("./data/setup-checklist.ts");
  assert.match(data, /^import "server-only";/);
  const view = source("../app/(app)/setup-checklist.tsx");
  assert.doesNotMatch(view, /_enc|createAdminClient|getSetupFacts/);
});

test("the Companies page counts setup with the directory's own team count, so both pages agree", () => {
  const loader = source("./data/platform-admin.ts");
  assert.match(loader, /listSetupSummaries\(new Map\(rows\.map\(\(r\) => \[r\.id, r\.team\]\)\)\)/);
});
