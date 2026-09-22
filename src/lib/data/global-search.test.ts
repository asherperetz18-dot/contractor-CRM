import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchGroups,
  ilikeAnyColumn,
  searchWords,
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
    phone2: null,
    phone3: null,
    email: "nuha@example.com",
    address: "5420 Wortser Ave, Sherman Oaks",
    zip: null,
    second_contact_first_name: null,
    second_contact_last_name: null,
    second_contact_phone: null,
    second_contact_email: null,
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

test("a search spanning two fields still matches when a field between them is empty", () => {
  // SQL builds its haystack with concat_ws, which skips NULL fields; the
  // re-filter here must join the same way, or a query that straddles two
  // fields ("ibrahim 5420") dies on the double space a null phone leaves.
  const groups = run("ibrahim 5420", { leads: [lead({ phone: null })] });
  assert.equal(group(groups, "Contacts")?.hits[0].name, "Nuha Ibrahim");
});

// Stored names arrive from imports, copy/paste and hurried typing with
// doubled, trailing, or non-breaking spaces. HTML collapses them when the
// record renders, so the contact LOOKS clean everywhere while a contiguous
// substring match quietly fails -- a client visibly "in the CRM" that
// search swears doesn't exist. Matching is per word on whitespace-folded
// text, so none of these can hide a record.

test("a stray double space inside a stored name cannot hide the contact or their contract", () => {
  const peter = lead({
    id: "lead-p",
    first_name: "PETER ", // trailing space typed into the field
    last_name: "BAHGAT IBRAHIM",
    phone: null,
    email: null,
    address: "18606 Community St, Northridge, CA 91324, USA",
  });
  const groups = run("peter bahgat", {
    leads: [peter],
    estimates: [estimate({ lead_id: "lead-p", title: "ADU" })],
    events: [],
    notes: [],
  });
  assert.equal(group(groups, "Contacts")?.hits[0].name, "PETER  BAHGAT IBRAHIM");
  assert.equal(group(groups, "Estimates & contracts")?.hits[0].name, "EST-1089 · ADU");
});

test("a non-breaking space pasted into a name still matches a plain-space query", () => {
  const groups = run("bahgat ibrahim", {
    leads: [lead({ first_name: "PETER", last_name: "BAHGAT IBRAHIM" })],
  });
  assert.equal(group(groups, "Contacts")?.hits.length, 1);
});

test("query words match in any order and may skip a middle name", () => {
  const peter = lead({ first_name: "PETER", last_name: "BAHGAT IBRAHIM" });
  assert.equal(group(run("ibrahim peter", { leads: [peter] }), "Contacts")?.hits.length, 1);
  assert.equal(group(run("peter ibrahim", { leads: [peter] }), "Contacts")?.hits.length, 1);
});

test("query words may straddle fields in any order", () => {
  // "northridge" lives in the address, "peter" in the name.
  const peter = lead({
    first_name: "PETER",
    last_name: "BAHGAT IBRAHIM",
    address: "18606 Community St, Northridge, CA 91324, USA",
  });
  assert.equal(group(run("northridge peter", { leads: [peter] }), "Contacts")?.hits.length, 1);
});

test("every query word must appear somewhere -- half a match is no match", () => {
  const peter = lead({ first_name: "PETER", last_name: "BAHGAT IBRAHIM" });
  assert.equal(group(run("peter jackson", { leads: [peter] }), "Contacts"), undefined);
});

test("non-adjacent words both inside a note find it, snippet anchored at the first", () => {
  const hit = group(run("delivery friday"), "Notes")?.hits[0];
  assert.ok(hit);
  assert.ok(hit.sub?.includes("delivery"));
});

// Every field the SQL haystack (migration 0170, leads.search_text) carries
// must find the contact here too, or the SQL prefilter returns a row the
// app then drops -- "No matches" for a record the database found.

test("a Company contact is found by its person's name, not only the company name", () => {
  const acme = lead({
    contact_type: "Company",
    company_name: "Acme Roofing LLC",
    first_name: "Dave",
    last_name: "Fernandez",
  });
  assert.equal(group(run("fernandez", { leads: [acme] }), "Contacts")?.hits[0].name, "Acme Roofing LLC");
  assert.equal(group(run("dave acme", { leads: [acme] }), "Contacts")?.hits.length, 1);
});

test("the second contact's name and phone find the record", () => {
  const joint = lead({
    second_contact_first_name: "Sam",
    second_contact_last_name: "Ibrahim",
    second_contact_phone: "(818) 555-0199",
  });
  assert.equal(group(run("sam ibrahim", { leads: [joint] }), "Contacts")?.hits.length, 1);
  assert.equal(group(run("8185550199", { leads: [joint] }), "Contacts")?.hits.length, 1);
});

test("a second or third phone number finds the contact, digits only or as typed", () => {
  const three = lead({ phone2: "818-555-0122", phone3: "(213) 555-0133" });
  assert.equal(group(run("8185550122", { leads: [three] }), "Contacts")?.hits.length, 1);
  assert.equal(group(run("555-0133", { leads: [three] }), "Contacts")?.hits.length, 1);
});

test("a zip code finds the contact", () => {
  assert.equal(group(run("91423", { leads: [lead({ zip: "91423" })] }), "Contacts")?.hits.length, 1);
});

test("a number stored with a country code still matches its own full digits", () => {
  // normalizePhone keeps the last 10 digits; the raw digits must count
  // too, or typing the number exactly as stored finds nothing.
  const intl = lead({ phone: "+1 (626) 325-4475" });
  assert.equal(group(run("16263254475", { leads: [intl] }), "Contacts")?.hits.length, 1);
  assert.equal(group(run("6263254475", { leads: [intl] }), "Contacts")?.hits.length, 1);
});

// When the global_search SQL function is missing or fails (a migration
// not yet run, a timeout), the action searches through PostgREST filters
// instead. Those filters are strings; a wrong escape either finds
// nothing or errors, and both read as "No matches".

test("searchWords folds whitespace, lowercases, and refuses a one-character query", () => {
  assert.deepEqual(searchWords("  Margo\u00a0 KATZ  "), ["margo", "katz"]);
  assert.deepEqual(searchWords("a"), []);
  assert.deepEqual(searchWords("   "), []);
});

test("ilikeAnyColumn builds one PostgREST or-filter per word across the given columns", () => {
  assert.equal(
    ilikeAnyColumn("katz", ["first_name", "last_name"]),
    'first_name.ilike."%katz%",last_name.ilike."%katz%"'
  );
});

test("ilikeAnyColumn keeps LIKE and PostgREST specials literal", () => {
  // % and _ are LIKE wildcards: backslash-escaped so "50%" finds "50%".
  assert.equal(ilikeAnyColumn("50%", ["notes"]), 'notes.ilike."%50\\\\%%"');
  assert.equal(ilikeAnyColumn("a_b", ["notes"]), 'notes.ilike."%a\\\\_b%"');
  // A comma or parenthesis would split the or-filter; the quotes hold it.
  assert.equal(ilikeAnyColumn("a,b(c)", ["notes"]), 'notes.ilike."%a,b(c)%"');
  // A double quote or backslash inside the quotes is escaped for PostgREST.
  assert.equal(ilikeAnyColumn('6"', ["notes"]), 'notes.ilike."%6\\"%"');
  assert.equal(ilikeAnyColumn("c:\\x", ["notes"]), 'notes.ilike."%c:\\\\\\\\x%"');
});
