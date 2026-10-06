import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IMPORT_DEFAULT_SOURCE,
  boughtListKeys,
  boughtListPlan,
  contactFormComplete,
  importSourceNames,
  countsAsLead,
  notALeadPattern,
  realLeadSources,
  sourceKey,
  sourceTag,
} from "./lead-or-contact.ts";

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

// ── The rule itself, mirrored by public.counts_as_lead (0211) ──────────

test("a source's key ignores case and surrounding spaces", () => {
  assert.equal(sourceKey("  CSV Import "), "csv import");
  assert.equal(sourceKey(null), "");
});

test("the bought-list keys are the ticked sources, once each", () => {
  assert.deepEqual(
    boughtListKeys([src("CSV Import", true), src("Google"), src("csv import ", true), src("Data Axle", true)]),
    ["csv import", "data axle"]
  );
});

test("a contact counts as a lead unless its source is blank or a bought list", () => {
  const bought = ["csv import", "data axle"];
  assert.equal(countsAsLead("Google Ads", bought), true, "CallRail's own source text, not on the list");
  assert.equal(countsAsLead("Facebook Lead Ads", bought), true);
  assert.equal(countsAsLead("CSV Import", bought), false);
  assert.equal(countsAsLead(" data AXLE ", bought), false);
  assert.equal(countsAsLead("", bought), false);
  assert.equal(countsAsLead("   ", bought), false);
  assert.equal(countsAsLead(null, bought), false);
  assert.equal(countsAsLead("CSV Import", []), true, "nothing ticked: only blanks are contacts");
});

test("the database filter pattern agrees with the rule, odd source names included", () => {
  const bought = boughtListKeys([src("CSV Import", true), src("A+ Leads (Q3)", true), src("list.v2 [old]", true)]);
  const pattern = new RegExp(notALeadPattern(bought), "i");
  // A row is kept by .not("source", "imatch", pattern) when the pattern
  // doesn't match it; a null source is never kept (NOT NULL is NULL).
  const kept = (s: string | null) => s !== null && !pattern.test(s);
  for (const s of [
    "Google", "csv import", " CSV IMPORT ", "A+ Leads (Q3)", "A Leads Q3", "list.v2 [old]", "listXv2 [old]",
    "", "  ", null, "CSV Import 2", "Website",
  ]) {
    assert.equal(kept(s), countsAsLead(s, bought), JSON.stringify(s));
  }
});

// ── Importing a bought list ────────────────────────────────────────────

test("an import's source names: each once, a blank cell is the importer's CSV Import", () => {
  assert.deepEqual(importSourceNames(["Data Axle", " data axle", "", "  ", "Data Axle Q3"]), [
    "Data Axle",
    IMPORT_DEFAULT_SOURCE,
    "Data Axle Q3",
  ]);
  assert.equal(IMPORT_DEFAULT_SOURCE, "CSV Import");
});

test("ticking an import's sources: existing ones by any spelling, missing ones added", () => {
  const existing = [
    { id: "s1", name: "CSV Import", bought_list: true },
    { id: "s2", name: "Data Axle", bought_list: false },
    { id: "s3", name: "Google", bought_list: false },
  ];
  assert.deepEqual(boughtListPlan(["csv import", "DATA AXLE ", "ListPro"], existing), {
    tick: ["s2"],
    add: ["ListPro"],
  });
  assert.deepEqual(boughtListPlan(["CSV Import"], existing), { tick: [], add: [] });
});

// ── The card's source tag ──────────────────────────────────────────────

test("a card's source tag says Lead in orange for a real lead, plain grey for a bought list", () => {
  const bought = ["csv import"];
  assert.deepEqual(sourceTag("Google", bought), { label: "Lead · Google", tone: "lead" });
  assert.deepEqual(sourceTag("CSV Import", bought), { label: "CSV Import", tone: "contact" });
  assert.equal(sourceTag("  ", bought), null, "no source, no tag -- as before");
  assert.equal(sourceTag(null, bought), null);
});
