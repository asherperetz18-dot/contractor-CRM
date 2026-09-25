import { test } from "node:test";
import assert from "node:assert/strict";
import { clientName, clientCompanyName, clientContactName, personName } from "./client-name.ts";

const coast = {
  contact_type: "Company",
  company_name: "Coast to Coast Water Damage & Restoration, Inc",
  first_name: "Josh",
  last_name: "Martinez",
};

test("a company client is the company, never its contact person", () => {
  assert.equal(clientName(coast), "Coast to Coast Water Damage & Restoration, Inc");
});

test("the person behind a company is its contact", () => {
  assert.equal(clientContactName(coast), "Josh Martinez");
});

test("an individual is their own name, with no separate contact", () => {
  const josh = { ...coast, contact_type: "Individual" };
  assert.equal(clientName(josh), "Josh Martinez");
  assert.equal(clientContactName(josh), null);
});

test("an individual with a company typed in (CSV import) is still the person", () => {
  assert.equal(
    clientName({ contact_type: "Individual", company_name: "Acme", first_name: "Ann", last_name: null }),
    "Ann"
  );
});

test("a company with no name yet is blank for the caller's fallback, never its contact", () => {
  const unnamed = { ...coast, company_name: "" };
  assert.equal(clientName(unnamed), "");
  assert.equal(clientContactName(unnamed), null);
});

test("a company with no contact person has no contact line", () => {
  assert.equal(clientContactName({ ...coast, first_name: null, last_name: " " }), null);
});

test("nothing known is an empty string, so each caller picks its own fallback", () => {
  assert.equal(clientName(null), "");
  assert.equal(clientName({ first_name: null, last_name: null }), "");
  assert.equal(personName(undefined), "");
});

test("the company a customer signer signs on behalf of -- only for a company client", () => {
  assert.equal(clientCompanyName(coast), "Coast to Coast Water Damage & Restoration, Inc");
  assert.equal(clientCompanyName({ ...coast, contact_type: "Individual" }), null);
  assert.equal(clientCompanyName({ ...coast, company_name: "" }), null);
});
