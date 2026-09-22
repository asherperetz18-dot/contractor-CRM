import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assistantRepScope,
  buildAssistantContext,
  formatCallDuration,
  MAX_ESTIMATES_IN_CONTEXT,
  MAX_LEADS_IN_CONTEXT,
  MAX_PROJECTS_IN_CONTEXT,
  MAX_CALLS_IN_CONTEXT,
  MAX_CHECKLIST_ITEMS_IN_CONTEXT,
  type AssistantChecklistItem,
  type AssistantContextInput,
  type AssistantEstimate,
  type AssistantProject,
  type AssistantCall,
} from "./assistant-context.ts";

/**
 * The context is what the AI answers from, so what goes wrong here goes
 * wrong out loud in chat: a section shown to a role the app hides it
 * from leaks money, and a summary computed off the capped detail list
 * repeats the exact "counted two thirds of the book while sounding
 * certain" bug the lead Summary already fixed. Both edges are pinned.
 */

const REP = "aaaaaaaa-0000-0000-0000-000000000001";

function baseInput(over: Partial<AssistantContextInput> = {}): AssistantContextInput {
  return {
    companyName: "Ace Roofing",
    todayISO: "2026-09-18",
    stages: ["New", "Appointment Scheduled", "Won", "Lost"],
    team: [{ id: REP, name: "Josh Closer" }],
    access: { canViewEstimates: true, canViewFinancials: true },
    leads: [],
    leadTotals: [],
    events: [],
    tasks: [],
    estimates: [],
    projects: [],
    checklists: [],
    calls: [],
    callWindowDays: 30,
    extraLeadNames: new Map(),
    ...over,
  };
}

function estimate(over: Partial<AssistantEstimate> = {}): AssistantEstimate {
  return {
    id: `e-${Math.random().toString(36).slice(2)}`,
    lead_id: "lead-1",
    doc_number: "EST-1001",
    title: "Roof replacement",
    status: "Draft",
    kind: "contract",
    total_cents: 100000,
    expires_at: null,
    signed_at: null,
    created_at: "2026-09-01T00:00:00Z",
    assigned_to: REP,
    parent_estimate_id: null,
    ...over,
  };
}

function project(over: Partial<AssistantProject> = {}): AssistantProject {
  return {
    estimateId: "est-1001",
    docNumber: "EST-1001",
    title: "Roof replacement",
    customer: "Bob Smith",
    address: "123 Main St",
    status: "in_progress",
    repName: "Josh Closer",
    signedAt: "2026-08-01T00:00:00Z",
    startDate: null,
    completionDate: null,
    soldCents: 5200000,
    collectedCents: 2000000,
    receivableCents: 500000,
    costCents: 800000,
    netCashCents: 1200000,
    unpaidBillsCents: 0,
    ...over,
  };
}

function call(over: Partial<AssistantCall> = {}): AssistantCall {
  return {
    created_at: "2026-09-17T14:02:00Z",
    direction: "outbound",
    disposition: "No Answer",
    status: "completed",
    duration_seconds: 45,
    rep_id: REP,
    lead_id: "lead-1",
    ...over,
  };
}

// ── Role gating ──────────────────────────────────────────────────────

test("without estimates access, the estimates section and every project dollar disappear", () => {
  const text = buildAssistantContext(
    baseInput({
      access: { canViewEstimates: false, canViewFinancials: false },
      estimates: [estimate({ status: "Signed", signed_at: "2026-09-01T00:00:00Z" })],
      projects: [project()],
    })
  );
  assert.ok(!text.includes("ESTIMATES"), "estimates section must not render");
  const projectSection = text.slice(text.indexOf("PROJECTS"));
  assert.ok(projectSection.includes("Bob Smith"), "project status stays visible");
  // The crew view's promise: no dollar figure anywhere in what the
  // server sends a Field user. The context is a server send.
  assert.ok(!projectSection.includes("$"), "no dollars for a viewer without estimate access");
});

test("money to collect renders only with financial access", () => {
  const withMoney = buildAssistantContext(
    baseInput({ projects: [project({ receivableCents: 500000 })] })
  );
  assert.ok(withMoney.includes("MONEY TO COLLECT"));
  assert.ok(withMoney.includes("$5,000.00"));

  const withoutMoney = buildAssistantContext(
    baseInput({
      access: { canViewEstimates: true, canViewFinancials: false },
      projects: [project({ receivableCents: 500000 })],
    })
  );
  assert.ok(!withoutMoney.includes("MONEY TO COLLECT"));
});

// ── Estimates funnel: same rules as the Estimates page cards ────────

test("funnel summary counts every document while detail lines stay capped", () => {
  const many = Array.from({ length: MAX_ESTIMATES_IN_CONTEXT + 10 }, (_, i) =>
    estimate({ doc_number: `EST-${2000 + i}`, created_at: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z` })
  );
  const text = buildAssistantContext(baseInput({ estimates: many }));
  // The accurate total, not the capped list's length.
  assert.ok(
    text.includes(`Drafts: ${MAX_ESTIMATES_IN_CONTEXT + 10}`),
    `summary must count all ${MAX_ESTIMATES_IN_CONTEXT + 10} drafts`
  );
  const section = text.slice(text.indexOf("ESTIMATES"), text.indexOf("PROJECTS"));
  const lines = section.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(lines.length, MAX_ESTIMATES_IN_CONTEXT);
  assert.ok(section.includes(`most recent ${MAX_ESTIMATES_IN_CONTEXT} of ${MAX_ESTIMATES_IN_CONTEXT + 10}`));
});

test("an expired Sent estimate counts as lost, and a void one keeps no money", () => {
  const text = buildAssistantContext(
    baseInput({
      estimates: [
        estimate({ status: "Sent", expires_at: "2026-01-01", total_cents: 700000 }),
        estimate({ status: "Void", total_cents: 900000 }),
        estimate({ status: "Signed", signed_at: "2026-09-01T00:00:00Z", total_cents: 300000 }),
      ],
    })
  );
  // The lapsed offer is not "awaiting signature" -- same rule as the page.
  assert.ok(text.includes("Awaiting signature: 0"));
  assert.ok(text.includes("Lost (declined/expired): 1 ($7,000.00)"));
  // Cancelled documents count, their money does not.
  assert.ok(text.includes("Cancelled: 1 ($0.00)"));
  assert.ok(text.includes("Signed contracts: 1 ($3,000.00)"));
});

test("a pending change order is chased, a signed one is money on the job", () => {
  const text = buildAssistantContext(
    baseInput({
      estimates: [
        estimate({ kind: "change_order", status: "Sent", total_cents: 150000, parent_estimate_id: "e-parent" }),
        estimate({ kind: "change_order", status: "Signed", total_cents: 250000, parent_estimate_id: "e-parent" }),
      ],
    })
  );
  assert.ok(text.includes("Change orders pending signature: 1 ($1,500.00)"));
});

// ── Leads: existing behavior preserved ───────────────────────────────

test("lead summary totals come from every row, lines from the capped roster", () => {
  const leads = Array.from({ length: 5 }, (_, i) => ({
    id: `lead-${i}`,
    contact_type: null,
    company_name: null,
    first_name: `Lead${i}`,
    last_name: "Person",
    phone: null,
    email: null,
    source: null,
    project_type: null,
    stage: "New",
    value: 1000,
    assigned_to: null,
    date_received: "2026-09-01",
    created_at: "2026-09-01T00:00:00Z",
  }));
  const totals = Array.from({ length: 1520 }, (_, i) => ({
    stage: i < 1500 ? "New" : "Won",
    value: 100,
  }));
  const text = buildAssistantContext(baseInput({ leads, leadTotals: totals }));
  assert.ok(text.includes("1500 open leads"));
  assert.ok(text.includes("1520 leads overall"));
  assert.ok(text.includes(`most recent 5 of 1520`));
  assert.ok(text.includes(String(MAX_LEADS_IN_CONTEXT)) === false || MAX_LEADS_IN_CONTEXT > 5);
});

// ── Projects ─────────────────────────────────────────────────────────

test("project lines are capped with active jobs first, totals span every job", () => {
  const projects = [
    ...Array.from({ length: MAX_PROJECTS_IN_CONTEXT + 5 }, (_, i) =>
      project({ docNumber: `EST-${3000 + i}`, status: "complete" as const, signedAt: `2026-07-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z` })
    ),
    project({ docNumber: "EST-ACTIVE", status: "in_progress" }),
  ];
  const text = buildAssistantContext(baseInput({ projects }));
  const section = text.slice(text.indexOf("PROJECTS"), text.indexOf("MONEY TO COLLECT"));
  const lines = section.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(lines.length, MAX_PROJECTS_IN_CONTEXT);
  // The one active job outranks every completed one for a context slot.
  assert.ok(lines[0].includes("EST-ACTIVE"));
  assert.ok(section.includes(`${MAX_PROJECTS_IN_CONTEXT + 6} projects`));
});

test("a cancelled project is listed but kept out of the money totals", () => {
  const text = buildAssistantContext(
    baseInput({
      projects: [
        project({ soldCents: 100000, collectedCents: 50000 }),
        project({ docNumber: "EST-DEAD", status: "cancelled", soldCents: 900000, collectedCents: 0 }),
      ],
    })
  );
  const section = text.slice(text.indexOf("PROJECTS"), text.indexOf("MONEY TO COLLECT"));
  assert.ok(section.includes("sold $1,000.00"), "totals exclude the cancelled job's sold figure");
  assert.ok(section.includes("EST-DEAD"));
});

// ── Money to collect ─────────────────────────────────────────────────

test("money to collect lists owing jobs largest first and skips settled ones", () => {
  const text = buildAssistantContext(
    baseInput({
      projects: [
        project({ docNumber: "EST-A", customer: "Alice", receivableCents: 100000 }),
        project({ docNumber: "EST-B", customer: "Bob", receivableCents: 700000 }),
        project({ docNumber: "EST-C", customer: "Carol", receivableCents: 0 }),
      ],
    })
  );
  const section = text.slice(text.indexOf("MONEY TO COLLECT"), text.indexOf("CALLS"));
  const lines = section.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(lines.length, 2, "a job with nothing owed is not chased");
  assert.ok(lines[0].includes("Bob"));
  assert.ok(section.includes("$8,000.00"), "total owed sums every owing job");
});

// ── Calls ────────────────────────────────────────────────────────────

test("call summary counts the whole window while lines stay capped", () => {
  const calls = Array.from({ length: MAX_CALLS_IN_CONTEXT + 20 }, (_, i) =>
    call({
      direction: i % 4 === 0 ? ("inbound" as const) : ("outbound" as const),
      disposition: i % 3 === 0 ? "Booked" : "No Answer",
      created_at: `2026-09-${String((i % 17) + 1).padStart(2, "0")}T10:00:00Z`,
    })
  );
  const text = buildAssistantContext(baseInput({ calls }));
  const section = text.slice(text.indexOf("CALLS"));
  assert.ok(section.includes(`${MAX_CALLS_IN_CONTEXT + 20} calls`));
  assert.ok(section.includes("Booked 40"));
  const lines = section.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(lines.length, MAX_CALLS_IN_CONTEXT);
});

test("a capped call fetch says so instead of passing a wrong total off as exact", () => {
  const capped = buildAssistantContext(
    baseInput({ calls: [call(), call(), call()], callsCapped: true })
  );
  assert.ok(capped.includes("3+ calls"), "a capped count reads as at-least");
  assert.ok(/most recent .* counted/i.test(capped));

  const exact = buildAssistantContext(baseInput({ calls: [call(), call()] }));
  assert.ok(exact.includes("2 calls"));
  assert.ok(!exact.includes("2+ calls"));
});

test("call durations read like a clock", () => {
  assert.equal(formatCallDuration(45), "0:45");
  assert.equal(formatCallDuration(225), "3:45");
  assert.equal(formatCallDuration(3661), "1:01:01");
  assert.equal(formatCallDuration(0), "0:00");
});

// ── Project checklists ───────────────────────────────────────────────

function checklistItem(over: Partial<AssistantChecklistItem> = {}): AssistantChecklistItem {
  return {
    id: `chk-${Math.random().toString(36).slice(2)}`,
    estimate_id: "est-1001",
    label: "Order materials",
    due_date: null,
    assigned_to: null,
    ...over,
  };
}

test("project lines carry the id a proposal must name", () => {
  const text = buildAssistantContext(
    baseInput({ projects: [project({ estimateId: "est-77", docNumber: "EST-77" })] })
  );
  assert.ok(text.includes("- id: est-77 | EST-77"));
});

test("open checklist steps list item ids, most urgent first, capped with true counts", () => {
  const items = Array.from({ length: MAX_CHECKLIST_ITEMS_IN_CONTEXT + 5 }, (_, i) =>
    checklistItem({ id: `chk-${i}`, due_date: "2026-09-25" })
  );
  items.push(checklistItem({ id: "chk-late", label: "Pull permit", due_date: "2026-09-01" }));
  const text = buildAssistantContext(
    baseInput({
      projects: [project({ estimateId: "est-1001", docNumber: "EST-1001" })],
      checklists: items,
    })
  );
  const section = text.slice(text.indexOf("PROJECT CHECKLISTS"), text.indexOf("MONEY TO COLLECT"));
  const lines = section.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(lines.length, MAX_CHECKLIST_ITEMS_IN_CONTEXT);
  // The step already overdue outranks every merely-scheduled one.
  assert.ok(lines[0].includes("chk-late"));
  assert.ok(lines[0].includes("(OVERDUE)"));
  assert.ok(lines[0].includes("EST-1001"), "steps name their project's document");
  // The true count, not the capped list's length.
  assert.ok(section.includes(`${MAX_CHECKLIST_ITEMS_IN_CONTEXT + 6} open steps`));
});

test("a checklist step never shows a dollar figure, so every role may see it", () => {
  const text = buildAssistantContext(
    baseInput({
      access: { canViewEstimates: false, canViewFinancials: false },
      projects: [project()],
      checklists: [checklistItem({ label: "Final walkthrough" })],
    })
  );
  const section = text.slice(text.indexOf("PROJECT CHECKLISTS"));
  assert.ok(section.includes("Final walkthrough"));
  assert.ok(!section.includes("$"));
});

// ── Names ────────────────────────────────────────────────────────────

test("an estimate whose lead fell off the roster still names its customer", () => {
  const text = buildAssistantContext(
    baseInput({
      estimates: [estimate({ lead_id: "old-lead", status: "Signed", signed_at: "2026-09-02T00:00:00Z" })],
      extraLeadNames: new Map([["old-lead", "Harriet Historic"]]),
    })
  );
  assert.ok(text.includes("Harriet Historic"));
});

// ── Rep scoping: who sees the whole company vs only their own book ──
//
// The route filters every fetch by this decision, so the rule itself
// must be pinned here: desk roles work the whole book; a user whose
// only hats are Sales/Field talks to a chat about their own records.

test("assistantRepScope: a Sales- or Field-only user is scoped to themselves", () => {
  const base = { id: REP, name: "Josh Closer", email: "josh@ace.com" };
  assert.deepEqual(assistantRepScope({ ...base, roles: ["Sales"] }), {
    id: REP,
    name: "Josh Closer",
  });
  assert.deepEqual(assistantRepScope({ ...base, roles: ["Field"] }), {
    id: REP,
    name: "Josh Closer",
  });
  assert.deepEqual(assistantRepScope({ ...base, roles: ["Sales", "Field"] }), {
    id: REP,
    name: "Josh Closer",
  });
  // No roles at all: least data is the safe direction.
  assert.deepEqual(assistantRepScope({ ...base, roles: [] }), {
    id: REP,
    name: "Josh Closer",
  });
});

test("assistantRepScope: any desk role sees the whole company", () => {
  const base = { id: REP, name: "Dana Desk", email: null };
  for (const role of [
    "Office",
    "Admin",
    "Dispatch",
    "Call Center",
    "Bookkeeping",
    "Production",
  ] as const) {
    assert.equal(assistantRepScope({ ...base, roles: [role] }), null, role);
    // A desk hat wins even alongside a Sales hat.
    assert.equal(assistantRepScope({ ...base, roles: ["Sales", role] }), null, `Sales+${role}`);
  }
});

test("assistantRepScope: name falls back to email, then a generic label", () => {
  assert.deepEqual(assistantRepScope({ id: REP, name: null, email: "j@x.com", roles: ["Sales"] }), {
    id: REP,
    name: "j@x.com",
  });
  assert.deepEqual(assistantRepScope({ id: REP, name: null, email: null, roles: ["Sales"] }), {
    id: REP,
    name: "This rep",
  });
});

test("scoped context announces the viewer and stops claiming company-wide", () => {
  const text = buildAssistantContext(
    baseInput({
      repScope: { id: REP, name: "Josh Closer" },
      leadTotals: [{ stage: "New", value: 5000 }],
    })
  );
  assert.ok(text.includes("VIEWER SCOPE"), "has the scope banner");
  assert.ok(text.includes("Josh Closer"), "names the rep");
  assert.ok(/ONLY records assigned to them/.test(text), "says it covers only their records");
  assert.ok(
    text.includes("accurate totals for Josh Closer's assigned leads"),
    "summary is labeled as theirs"
  );
  assert.ok(!text.includes("company-wide"), "never claims company-wide numbers");
});

test("unscoped context keeps the company-wide summary and no viewer banner", () => {
  const text = buildAssistantContext(baseInput({ leadTotals: [{ stage: "New", value: 5000 }] }));
  assert.ok(text.includes("company-wide"), "full view keeps the company-wide label");
  assert.ok(!text.includes("VIEWER SCOPE"), "no banner for desk roles");
});
