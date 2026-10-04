import { test } from "node:test";
import assert from "node:assert/strict";
import { companyEmailPlan, companyFromHeader } from "./email-from.ts";

// A company with no sender of its own in Settings → Email falls back to the
// platform's EMAIL_FROM -- whose display name is La Home Contractor. Team Pro
// Restoration's customer got an estimate "from La Home Contractor". The
// fallback keeps the platform's (verified) address but shows the company.

const PLATFORM = "La Home Contractor <info@lahomecontractor.com>";

test("no sender of its own: the platform address under the company's name", () => {
  const from = companyFromHeader(
    { email_from: null, email_from_name: null, name: "Team Pro Restoration" },
    PLATFORM
  );
  assert.equal(from, "Team Pro Restoration <info@lahomecontractor.com>");
});

test("a sender name set without an address still wins over the company name", () => {
  const from = companyFromHeader(
    { email_from: null, email_from_name: "Team Pro Estimates", name: "Team Pro Restoration" },
    PLATFORM
  );
  assert.equal(from, "Team Pro Estimates <info@lahomecontractor.com>");
});

test("a bare platform address takes the company's name too", () => {
  const from = companyFromHeader(
    { email_from: null, email_from_name: null, name: "Team Pro Restoration" },
    "info@lahomecontractor.com"
  );
  assert.equal(from, "Team Pro Restoration <info@lahomecontractor.com>");
});

test("the company's own address is used as before", () => {
  assert.equal(
    companyFromHeader(
      { email_from: "office@teampro.com", email_from_name: "Team Pro", name: "Team Pro Restoration" },
      PLATFORM
    ),
    "Team Pro <office@teampro.com>"
  );
  assert.equal(
    companyFromHeader({ email_from: "office@teampro.com", email_from_name: null, name: "Team Pro" }, PLATFORM),
    "office@teampro.com"
  );
});

test("a name that would break the header is cleaned, and punctuation is quoted", () => {
  const from = companyFromHeader(
    { email_from: null, email_from_name: null, name: 'Smith & Sons, Inc. <"best">\r\n' },
    PLATFORM
  );
  assert.equal(from, '"Smith & Sons, Inc. best" <info@lahomecontractor.com>');
});

test("characters sendEmail refuses (emoji, em dash) are dropped, never failing the send", () => {
  const from = companyFromHeader(
    { email_from: null, email_from_name: null, name: "Team Pro — Restoration 🏠" },
    PLATFORM
  );
  assert.equal(from, "Team Pro Restoration <info@lahomecontractor.com>");
  assert.ok([...from].every((ch) => ch.charCodeAt(0) <= 255));
});

test("an empty profile name falls back to the company's account name", () => {
  // company_profile.name is optional; companies.name always exists.
  const from = companyFromHeader(
    { email_from: null, email_from_name: null, name: null, company_name: "Smart Hvac System" },
    PLATFORM
  );
  assert.equal(from, "Smart Hvac System <info@lahomecontractor.com>");
});

test("with no usable name at all, the bare address -- never the platform's own name", () => {
  for (const company of [
    { email_from: null, email_from_name: null, name: null },
    { email_from: null, email_from_name: "  ", name: "🏠", company_name: "" },
  ]) {
    const from = companyFromHeader(company, PLATFORM);
    assert.equal(from, "info@lahomecontractor.com");
    assert.ok(!from.includes("La Home Contractor"));
  }
});

// ---- Which account sends, from which address, and where replies go
// (DECISIONS #110). A company's own address goes out only through its own
// Resend account, where Resend itself has checked the company controls the
// domain. Without one, AI Build Pros sends under the company's name and the
// customer's reply goes to the company -- never to the platform's inbox.

const AIBP = "AI Build Pros <notifications@aibuildpros.com>";

test("own address with its own Resend account: sent as the company, replies come back to it", () => {
  const plan = companyEmailPlan(
    { email_from: "office@teampro.com", email_from_name: "Team Pro", name: "Team Pro Restoration", email: "info@teampro.com" },
    true,
    AIBP
  );
  assert.deepEqual(plan, { key: "company", from: "Team Pro <office@teampro.com>", replyTo: null });
});

test("own address but no Resend account of its own: never sent from that address on the shared account", () => {
  // The shared account sends for every domain verified in it -- including
  // La Home's. A company could otherwise type La Home's address and send as
  // La Home. It goes out from AI Build Pros under the company's name, and
  // replies still reach the address the company typed.
  const plan = companyEmailPlan(
    { email_from: "info@lahomecontractor.com", email_from_name: null, name: "Ca Pro Builder" },
    false,
    AIBP
  );
  assert.deepEqual(plan, {
    key: "platform",
    from: "Ca Pro Builder <notifications@aibuildpros.com>",
    replyTo: "info@lahomecontractor.com",
  });
});

test("no address of its own: AI Build Pros sends, the company's email gets the replies", () => {
  const plan = companyEmailPlan(
    { email_from: null, email_from_name: null, name: "Ca Pro Builder", email: "office@caprobuilder.com" },
    false,
    AIBP
  );
  assert.deepEqual(plan, {
    key: "platform",
    from: "Ca Pro Builder <notifications@aibuildpros.com>",
    replyTo: "office@caprobuilder.com",
  });
});

test("the company's main email wins over a typed sender address for replies", () => {
  const plan = companyEmailPlan(
    { email_from: "estimates@x.com", email_from_name: null, name: "X Co", email: "office@x.com" },
    false,
    AIBP
  );
  assert.equal(plan?.replyTo, "office@x.com");
});

test("something that isn't an email address is never used for replies", () => {
  const plan = companyEmailPlan(
    { email_from: null, email_from_name: null, name: "X Co", email: "call us!" },
    false,
    AIBP
  );
  assert.equal(plan?.replyTo, null);
});

test("no shared sender configured: only a company with its own account can send", () => {
  assert.equal(companyEmailPlan({ email_from: null, email_from_name: null, name: "X Co" }, false, null), null);
  assert.equal(companyEmailPlan({ email_from: "a@x.com", email_from_name: null, name: "X Co" }, false, null), null);
  assert.equal(companyEmailPlan({ email_from: "a@x.com", email_from_name: null, name: "X Co" }, true, null)?.key, "company");
});
