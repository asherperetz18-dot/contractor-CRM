import { test } from "node:test";
import assert from "node:assert/strict";
import { companyFromHeader } from "./email-from.ts";

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
