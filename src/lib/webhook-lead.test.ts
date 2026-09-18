import { test } from "node:test";
import assert from "node:assert/strict";
import { webhookLeadFields } from "./webhook-lead.ts";

/**
 * One mapper feeds both doors into /api/leads/webhook: the JSON/form POST
 * (website forms, Zapier) and the query-string GET that dialer "web form"
 * buttons fire (ViciDial can only open a URL). The POST cases pin the
 * contract external forms already rely on; the GET cases pin ViciDial's
 * own field names, which arrive as a flat bag of strings with empty
 * strings for everything the agent left blank.
 */

test("website form: one name field splits, first/last win over it", () => {
  const split = webhookLeadFields({ name: "Jane van der Berg" });
  assert.ok(split);
  assert.equal(split.first_name, "Jane");
  assert.equal(split.last_name, "van der Berg");

  const explicit = webhookLeadFields({
    name: "Ignored Name",
    first_name: "Bob",
    last_name: "Builder",
  });
  assert.ok(explicit);
  assert.equal(explicit.first_name, "Bob");
  assert.equal(explicit.last_name, "Builder");

  const camel = webhookLeadFields({ firstName: "Ann", lastName: "Lee", full_name: "Zz Top" });
  assert.ok(camel);
  assert.equal(camel.first_name, "Ann");
  assert.equal(camel.last_name, "Lee");
});

test("existing POST contract: aliases, defaults, and value parsing hold", () => {
  const lead = webhookLeadFields({
    full_name: "Sam Roof",
    phone_number: "555-0100",
    projectType: "Kitchen",
    message: "Call after 5",
    value: "2500",
  });
  assert.ok(lead);
  assert.equal(lead.phone, "555-0100");
  assert.equal(lead.project_type, "Kitchen");
  assert.equal(lead.notes, "Call after 5");
  assert.equal(lead.value, 2500);
  assert.equal(lead.source, "Website");

  const junkValue = webhookLeadFields({ phone: "555", value: "a lot" });
  assert.ok(junkValue);
  assert.equal(junkValue.value, 0);
  const explicitSource = webhookLeadFields({ phone: "555", source: "Vicidial" });
  assert.ok(explicitSource);
  assert.equal(explicitSource.source, "Vicidial");
});

test("vicidial web form: phone_number, comments, and address1/city/state/zip land", () => {
  // The interesting slice of what ViciDial appends to the web-form URL —
  // unfilled fields arrive as "" rather than being absent.
  const lead = webhookLeadFields({
    lead_id: "48211",
    vendor_lead_code: "",
    phone_number: "3105550142",
    first_name: "Maria",
    last_name: "Lopez",
    address1: "123 Main St",
    address2: "Apt 4",
    address3: "",
    city: "Torrance",
    state: "CA",
    postal_code: "90501",
    email: "maria@example.com",
    comments: "Wants a roof estimate",
    source: "Vicidial",
  });
  assert.ok(lead);
  assert.equal(lead.first_name, "Maria");
  assert.equal(lead.phone, "3105550142");
  assert.equal(lead.email, "maria@example.com");
  assert.equal(lead.address, "123 Main St, Apt 4, Torrance, CA 90501");
  assert.equal(lead.notes, "Wants a roof estimate");
  assert.equal(lead.source, "Vicidial");
});

test("address pieces: empties never leave stray commas, explicit address wins", () => {
  const cityOnly = webhookLeadFields({ phone: "555", city: "Reno", state: "", postal_code: "" });
  assert.ok(cityOnly);
  assert.equal(cityOnly.address, "Reno");

  const zipNoState = webhookLeadFields({ phone: "555", address1: "9 Elm", postal_code: "89501" });
  assert.ok(zipNoState);
  assert.equal(zipNoState.address, "9 Elm, 89501");

  const explicit = webhookLeadFields({ phone: "555", address: "As Given 1", city: "Ignored" });
  assert.ok(explicit);
  assert.equal(explicit.address, "As Given 1");

  const none = webhookLeadFields({ phone: "555" });
  assert.ok(none);
  assert.equal(none.address, null);
});

test("a lead with no name, phone, or email is refused; blanks don't count", () => {
  assert.equal(webhookLeadFields({}), null);
  assert.equal(webhookLeadFields({ address1: "1 Road", comments: "hi" }), null);
  assert.equal(webhookLeadFields({ name: "   ", phone: "", email: "" }), null);
  assert.notEqual(webhookLeadFields({ email: "a@b.c" }), null);
});
