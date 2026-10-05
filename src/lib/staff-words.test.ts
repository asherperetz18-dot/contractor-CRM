import { test } from "node:test";
import assert from "node:assert/strict";
import { estimatesCardLabel, quickCreateLabels, relabelNav, staffPageLabel } from "./staff-words.ts";
import { STANDARD_WORDS, readCompanyWords } from "./company-words.ts";
import type { NavEntry } from "./data/types.ts";

/**
 * The staff screens in the company's own words (DECISIONS #125): an HVAC
 * company's menu says "Jobs" and "Technicians". A company on the standard
 * words sees exactly the labels it always has -- each label changes only
 * when a word in it was changed.
 */

const HVAC = readCompanyWords({
  estimate: { one: "Quote", many: "Quotes" },
  project: { one: "Job", many: "Jobs" },
  appointment: { one: "Service Call", many: "Service Calls" },
  rep: { one: "Technician", many: "Technicians" },
  contract: { one: "Work Authorization", many: "Work Authorizations" },
});

test("menu labels follow the company's words", () => {
  assert.equal(staffPageLabel("/estimates", "Estimates & Contracts", HVAC), "Quotes & Work Authorizations");
  assert.equal(staffPageLabel("/estimate-status", "Estimate Status", HVAC), "Quote Status");
  assert.equal(staffPageLabel("/projects", "Projects", HVAC), "Jobs");
  assert.equal(staffPageLabel("/contracts", "Contracts", HVAC), "Work Authorizations");
  assert.equal(staffPageLabel("/appointment-reports", "Appointment Reports", HVAC), "Service Call Reports");
  assert.equal(staffPageLabel("/salespeople", "Salespeople", HVAC), "Technicians");
  assert.equal(staffPageLabel("/estimate-approvals", "Estimate Approvals", HVAC), "Quote Approvals");
  // Pages with no company word in them keep their label.
  assert.equal(staffPageLabel("/calendar", "Calendar", HVAC), "Calendar");
});

test("the standard words change nothing, not even Salespeople", () => {
  for (const [href, label] of [
    ["/estimates", "Estimates & Contracts"],
    ["/estimate-status", "Estimate Status"],
    ["/projects", "Projects"],
    ["/salespeople", "Salespeople"],
    ["/appointment-reports", "Appointment Reports"],
  ]) {
    assert.equal(staffPageLabel(href, label, STANDARD_WORDS), label);
  }
  assert.equal(estimatesCardLabel("sent", "Proposals", STANDARD_WORDS), "Proposals");
  assert.deepEqual(quickCreateLabels(STANDARD_WORDS), {
    appointment: "New Appointment",
    job: "New Job",
    estimatesGroup: "Estimates & Invoices",
    estimate: "New Estimate",
    contractsGroup: "Contracts",
    contract: "New Contract",
  });
});

test("only the changed word moves: a roofer keeps Estimates, gets Inspection Reports", () => {
  const roofer = readCompanyWords({ appointment: { one: "Inspection", many: "Inspections" } });
  assert.equal(staffPageLabel("/estimates", "Estimates & Contracts", roofer), "Estimates & Contracts");
  assert.equal(staffPageLabel("/appointment-reports", "Appointment Reports", roofer), "Inspection Reports");
});

test("the sidebar relabels its links but keeps group names (saved menu order is keyed on them)", () => {
  const nav: NavEntry[] = [
    { type: "link", href: "/estimates", label: "Estimates & Contracts", icon: "x" },
    {
      type: "group",
      label: "Production",
      icon: "y",
      items: [
        { label: "Projects", href: "/projects" },
        { label: "Production Board", href: "/production" },
      ],
    },
  ];
  const out = relabelNav(nav, HVAC);
  assert.equal(out[0].label, "Quotes & Work Authorizations");
  assert.equal(out[1].label, "Production");
  assert.deepEqual(
    out[1].type === "group" ? out[1].items.map((i) => i.label) : [],
    ["Jobs", "Production Board"]
  );
});

test("estimate list cards and Quick Create in the company's words", () => {
  assert.equal(estimatesCardLabel("sent", "Proposals", HVAC), "Quotes");
  assert.equal(estimatesCardLabel("signed", "Contracts", HVAC), "Work Authorizations");
  assert.equal(estimatesCardLabel("declined", "Declined", HVAC), "Declined");
  const q = quickCreateLabels(HVAC);
  assert.equal(q.appointment, "New Service Call");
  assert.equal(q.job, "New Job");
  assert.equal(q.estimate, "New Quote");
  assert.equal(q.estimatesGroup, "Quotes & Invoices");
  assert.equal(q.contract, "New Work Authorization");
});
