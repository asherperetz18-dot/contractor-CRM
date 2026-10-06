import { test } from "node:test";
import assert from "node:assert/strict";
import { contactFormComplete, realLeadSources } from "./lead-or-contact.ts";

/**
 * Everyone on the Pipeline is a contact; a contact is a lead only when it
 * came from a real lead source (DECISIONS #156). Bought cold-call lists
 * are contacts. Quick Create's New Lead offers only the real sources and
 * won't save without one, so a lead typed in by hand can't lose its
 * source and drop out of the lead numbers.
 */

const src = (name: string, bought_list?: boolean) => ({ id: name, name, bought_list });

test("New Lead offers every source that isn't ticked as a bought list", () => {
  const sources = [src("Google"), src("Data Axle List", true), src("Facebook", false), src("CSV Import", true)];
  assert.deepEqual(
    realLeadSources(sources).map((s) => s.name),
    ["Google", "Facebook"]
  );
});

test("before the bought-list column exists every source is offered", () => {
  assert.deepEqual(
    realLeadSources([src("Google"), src("Website")]).map((s) => s.name),
    ["Google", "Website"]
  );
});

const person = {
  contact_type: "Individual" as const,
  company_name: "",
  first_name: "Maria",
  last_name: "Alvarez",
  phone: "8185550142",
  source: "",
};

test("a contact needs a name and a phone, not a source", () => {
  assert.equal(contactFormComplete(person, { asLead: false }), true);
  assert.equal(contactFormComplete({ ...person, phone: " " }, { asLead: false }), false);
  assert.equal(contactFormComplete({ ...person, last_name: "" }, { asLead: false }), false);
});

test("a company contact needs the company name and a phone", () => {
  const company = { ...person, contact_type: "Company" as const, first_name: "", last_name: "" };
  assert.equal(contactFormComplete({ ...company, company_name: "Acme Builders" }, { asLead: false }), true);
  assert.equal(contactFormComplete(company, { asLead: false }), false);
});

test("a new lead also needs its source", () => {
  assert.equal(contactFormComplete(person, { asLead: true }), false);
  assert.equal(contactFormComplete({ ...person, source: "  " }, { asLead: true }), false);
  assert.equal(contactFormComplete({ ...person, source: "Google" }, { asLead: true }), true);
});
