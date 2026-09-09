import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchGroups,
  type SearchableBill,
  type SearchableEstimate,
  type SearchableEvent,
  type SearchableLead,
  type SearchableNote,
} from "./global-search.ts";

/**
 * "Search for Anything" matching rules, pinned. The promise on the tin
 * is the placeholder text: whatever you start typing -- a name, a phone
 * in any formatting, an EST number, a job title, a vendor -- finds the
 * record. Each rule here is a way a real search would otherwise come
 * back empty.
 */

function lead(over: Partial<SearchableLead> = {}): SearchableLead {
  return {
    id: "lead-1",
    contact_type: "Individual",
    company_name: null,
    first_name: "Nuha",
    last_name: "Ibrahim",
    phone: "(626) 325-4475",
    email: "nuha@example.com",
    address: "5420 Wortser Ave, Sherman Oaks",
    stage: "Sold",
    ...over,
  };
}

function estimate(over: Partial<SearchableEstimate> = {}): SearchableEstimate {
  return {
    id: "est-1",
    lead_id: "lead-1",
    doc_number: "EST-1089",
    title: "POOL REMODEL",
    status: "Signed",
    kind: "contract",
    job_address: null,
    total_cents: 10255000,
    ...over,
  };
}

function event(over: Partial<SearchableEvent> = {}): SearchableEvent {
  return {
    id: "ev-1",
    title: "Final walkthrough",
    date: "2026-09-10",
    time: "14:30:00",
    event_type: "Site Visit",
    status: "Confirmed",
    lead_id: "lead-1",
    notes: null,
    ...over,
  };
}

function bill(over: Partial<SearchableBill> = {}): SearchableBill {
  return {
    id: "bill-1",
    vendor_name: "Home Depot",
    reference: "INV-4471",
    amount_cents: 123456,
    due_date: "2026-09-20",
    notes: null,
    voided_at: null,
    ...over,
  };
}

function note(over: Partial<SearchableNote> = {}): SearchableNote {
  return {
    id: "note-1",
    lead_id: "lead-1",
    body: "📞 Customer asked to move the tile delivery to Friday morning",
    created_at: "2026-09-05T18:22:00Z",
    ...over,
  };
}

const stages = [{ name: "Sold", color: "#16a34a" }];

function run(q: string, input: Partial<Parameters<typeof buildSearchGroups>[1]> = {}) {
  return buildSearchGroups(q, {
    leads: [lead()],
    stages,
    estimates: [estimate()],
    events: [event()],
    bills: [bill()],
    notes: [note()],
    ...input,
  });
}

function group(groups: ReturnType<typeof buildSearchGroups>, label: string) {
  return groups.find((g) => g.label === label);
}

test("a client's name finds their contact, their contract, and their appointment", () => {
  const groups = run("nuha");
  assert.equal(group(groups, "Contacts")?.hits[0].name, "Nuha Ibrahim");
  assert.equal(group(groups, "Estimates & contracts")?.hits[0].name, "EST-1089 · POOL REMODEL");
  assert.equal(group(groups, "Appointments")?.hits[0].name, "Final walkthrough");
  // The vendor bill has nothing to do with Nuha; its group must not appear.
  assert.equal(group(groups, "Bills"), undefined);
});

test("digits-only phone search matches a formatted stored number", () => {
  const groups = run("6263254475");
  assert.equal(group(groups, "Contacts")?.hits.length, 1);
});

test("an EST number fragment finds the document and routes to it", () => {
  const hit = group(run("1089"), "Estimates & contracts")?.hits[0];
  assert.ok(hit);
  assert.equal(hit.href, "/estimates/est-1");
  assert.equal(hit.badge, "Signed");
});

test("a job title fragment finds the document case-insensitively", () => {
  assert.equal(group(run("pool"), "Estimates & contracts")?.hits.length, 1);
});

test("a change order says so on its badge instead of posing as a contract", () => {
  const groups = run("1089", { estimates: [estimate({ kind: "change_order", status: "Draft" })] });
  assert.equal(group(groups, "Estimates & contracts")?.hits[0].badge, "Change order · Draft");
});

test("an appointment is found by its title and routes to the calendar deep link", () => {
  const hit = group(run("walkthrough"), "Appointments")?.hits[0];
  assert.ok(hit);
  assert.equal(hit.href, "/calendar?openEvent=ev-1");
});

test("a vendor name finds the bill with its amount on the badge", () => {
  const hit = group(run("home depot"), "Bills")?.hits[0];
  assert.ok(hit);
  assert.equal(hit.badge, "$1,234.56");
  assert.equal(hit.href, "/bills");
});

test("a voided bill is still findable but reads Void, not an amount", () => {
  const groups = run("home depot", { bills: [bill({ voided_at: "2026-09-01T00:00:00Z" })] });
  assert.equal(group(groups, "Bills")?.hits[0].badge, "Void");
});

test("each group caps at five hits so one noisy word cannot bury the rest", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    lead({ id: `lead-${i}`, first_name: "Nuha", last_name: `Clone ${i}` })
  );
  const groups = run("nuha", { leads: many, estimates: [], events: [], bills: [] });
  assert.equal(group(groups, "Contacts")?.hits.length, 5);
});

test("a one-character query returns nothing rather than everything", () => {
  assert.deepEqual(run("n"), []);
});

test("an estimate whose lead is gone still matches on its own text", () => {
  const groups = run("pool", { leads: [] });
  assert.equal(group(groups, "Estimates & contracts")?.hits.length, 1);
});

test("a word inside a note finds it, named after the client, opening their card", () => {
  const hit = group(run("tile delivery"), "Notes")?.hits[0];
  assert.ok(hit);
  assert.equal(hit.name, "Nuha Ibrahim");
  assert.equal(hit.href, "/contacts?openLead=lead-1");
  assert.equal(hit.badge, "Note");
  assert.ok(hit.sub?.includes("tile delivery"));
});

test("a note is matched by its body only, not by the client's name", () => {
  // Searching the client already surfaces the contact; repeating every
  // note of theirs would bury the other groups.
  assert.equal(group(run("nuha"), "Notes"), undefined);
});

test("a long note shows the text around the match, not its first line", () => {
  const long = note({
    body: `🤖 AI call notes ${"x".repeat(200)} promised a callback tomorrow ${"y".repeat(200)}`,
  });
  const hit = group(run("callback", { notes: [long] }), "Notes")?.hits[0];
  assert.ok(hit);
  assert.ok(hit.sub?.includes("promised a callback tomorrow"));
  assert.ok(hit.sub!.length < 160);
});

test("a note whose lead is not visible is dropped rather than unlinkable", () => {
  const groups = run("tile delivery", { leads: [] });
  assert.equal(group(groups, "Notes"), undefined);
});
