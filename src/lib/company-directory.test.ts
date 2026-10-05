import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BILLING_STATE_LABEL,
  billingState,
  buildCompanyDirectory,
  directoryCounts,
  filterCompanyDirectory,
  type DirectoryMember,
} from "./company-directory.ts";

function member(over: Partial<DirectoryMember> = {}): DirectoryMember {
  return {
    company_id: "c1",
    roles: ["Office", "Admin"],
    status: "Active",
    granted_via_platform_admin: false,
    created_at: "2026-09-01T10:00:00Z",
    profiles: { name: "Dana Owner", email: "dana@example.com" },
    ...over,
  };
}

test("billing reads as what it means for the company", () => {
  assert.equal(billingState(undefined), "not_billed");
  assert.equal(billingState({ billing_status: null }), "unsynced");
  assert.equal(billingState({ billing_status: "active" }), "paying");
  assert.equal(billingState({ billing_status: "trialing" }), "trial");
  assert.equal(billingState({ billing_status: "past_due" }), "payment_failed");
  assert.equal(billingState({ billing_status: "incomplete" }), "payment_failed");
  for (const s of ["canceled", "unpaid", "incomplete_expired", "paused"]) {
    assert.equal(billingState({ billing_status: s }), "locked", s);
  }
  // A status Stripe adds later is shown as not yet known, never as paying.
  assert.equal(billingState({ billing_status: "something_new" }), "unsynced");
  for (const label of Object.values(BILLING_STATE_LABEL)) assert.ok(label.length > 0);
});

test("the team counts the company's own active people, not platform admins looking in", () => {
  const [row] = buildCompanyDirectory(
    [{ id: "c1", name: "Summit Builders Co", created_at: "2026-09-01T09:00:00Z" }],
    [
      member(),
      member({ profiles: { name: "Sam Rep", email: "sam@example.com" }, roles: ["Sales"], created_at: "2026-09-02T10:00:00Z" }),
      member({ status: "Inactive", profiles: { name: "Gone", email: "gone@example.com" } }),
      member({ granted_via_platform_admin: true, profiles: { name: "Platform", email: "ops@example.com" } }),
      member({ company_id: "c2" }),
    ],
    []
  );
  assert.equal(row.team, 2);
});

test("the owner is the company's earliest Office or Admin, never a platform admin's seat", () => {
  const [row] = buildCompanyDirectory(
    [{ id: "c1", name: "Summit Builders Co", created_at: "2026-09-01T09:00:00Z" }],
    [
      member({
        granted_via_platform_admin: true,
        created_at: "2026-08-01T00:00:00Z",
        profiles: { name: "Platform", email: "ops@example.com" },
      }),
      member({ roles: ["Sales"], created_at: "2026-08-15T00:00:00Z", profiles: { name: "Early Rep", email: "rep@example.com" } }),
      member({ created_at: "2026-09-03T00:00:00Z", profiles: { name: "Later Admin", email: "later@example.com" } }),
      member(),
    ],
    []
  );
  assert.deepEqual(row.owner, { name: "Dana Owner", email: "dana@example.com" });
});

test("a company with nobody of its own shows no owner and a team of zero", () => {
  const [row] = buildCompanyDirectory(
    [{ id: "c1", name: "Empty Co", created_at: "2026-09-01T09:00:00Z" }],
    [member({ granted_via_platform_admin: true })],
    []
  );
  assert.equal(row.owner, null);
  assert.equal(row.team, 0);
});

test("rows carry billing and come out in name order", () => {
  const rows = buildCompanyDirectory(
    [
      { id: "c2", name: "zephyr Roofing", created_at: "2026-09-02T00:00:00Z" },
      { id: "c1", name: "Apex HVAC", created_at: "2026-09-01T00:00:00Z" },
    ],
    [],
    [{ company_id: "c2", billing_status: "active" }, { company_id: "c1", billing_status: "trialing", trial_ends_at: "2026-10-30T00:00:00Z" }]
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.trialEndsAt]),
    [
      ["Apex HVAC", "2026-10-30T00:00:00Z"],
      ["zephyr Roofing", null],
    ]
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.billing, r.createdAt]),
    [
      ["Apex HVAC", "trial", "2026-09-01T00:00:00Z"],
      ["zephyr Roofing", "paying", "2026-09-02T00:00:00Z"],
    ]
  );
});

test("search finds a company by its name or its owner, and the filter by billing", () => {
  const rows = buildCompanyDirectory(
    [
      { id: "c1", name: "Apex HVAC", created_at: "2026-09-01T00:00:00Z" },
      { id: "c2", name: "Summit Builders Co", created_at: "2026-09-02T00:00:00Z" },
    ],
    [member({ company_id: "c2" })],
    [{ company_id: "c1", billing_status: "trialing" }]
  );
  assert.deepEqual(filterCompanyDirectory(rows, "all", "  apex ").map((r) => r.id), ["c1"]);
  assert.deepEqual(filterCompanyDirectory(rows, "all", "DANA").map((r) => r.id), ["c2"]);
  assert.deepEqual(filterCompanyDirectory(rows, "all", "dana@example").map((r) => r.id), ["c2"]);
  assert.deepEqual(filterCompanyDirectory(rows, "trial", "").map((r) => r.id), ["c1"]);
  assert.deepEqual(filterCompanyDirectory(rows, "trial", "summit"), []);
  assert.deepEqual(filterCompanyDirectory(rows, "all", "").length, 2);

  const counts = directoryCounts(rows);
  assert.equal(counts.all, 2);
  assert.equal(counts.trial, 1);
  assert.equal(counts.not_billed, 1);
  assert.equal(counts.paying, 0);
});

test("each company carries this month's AI uses, texts and emails, zero when it has none", () => {
  const rows = buildCompanyDirectory(
    [
      { id: "c1", name: "Apex HVAC", created_at: "2026-09-01T00:00:00Z" },
      { id: "c2", name: "Summit Builders Co", created_at: "2026-09-02T00:00:00Z" },
    ],
    [],
    [],
    [{ company_id: "c2", month: "2026-10-01", ai_requests: 12, ai_input_tokens: 9000, ai_output_tokens: 800, sms_sent: 340, emails_sent: 25 }]
  );
  assert.deepEqual(rows.map((r) => [r.name, r.usage.aiRequests, r.usage.smsSent, r.usage.emailsSent]), [
    ["Apex HVAC", 0, 0, 0],
    ["Summit Builders Co", 12, 340, 25],
  ]);
});
