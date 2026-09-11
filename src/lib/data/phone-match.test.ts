import { test } from "node:test";
import assert from "node:assert/strict";
import {
  phoneIndex,
  phoneKey,
  phoneMatchIn,
  phoneMatchInIndex,
  rememberInIndex,
  soleLeadId,
  type LeadPhoneRow,
} from "./phone-match.ts";
import { normalizePhone } from "./types.ts";

/**
 * Telling "nobody has this number" apart from "several people do".
 *
 * This is the rule the CallRail importer uses to decide whether a caller
 * is new. Getting it wrong does not lose data -- it manufactures it, one
 * fresh copy of the same person every time the sweep re-reads their
 * call. So both edges are pinned down.
 */

const bare = { phone2: null, phone3: null, second_contact_phone: null };
const rows: LeadPhoneRow[] = [
  { id: "thelma", phone: "+1 323-806-7609", ...bare },
  { id: "jeremy", phone: "(818) 268-7398", ...bare },
  { id: "sandra", phone: "818-268-7398", ...bare },
  { id: "carlos", phone: "760 790 4576", ...bare, second_contact_phone: "13237778888" },
  { id: "blank", phone: null, ...bare },
  { id: "short", phone: "555-1234", ...bare },
  // Bought cold-call lists carry up to three numbers for one person.
  { id: "dialed", phone: "213-444-1000", ...bare, phone2: "213-444-2000", phone3: "213-444-3000" },
];

test("a number nobody has is 'none' -- the only case that may create a contact", () => {
  assert.deepEqual(phoneMatchIn(rows, "310-555-0199"), { kind: "none" });
});

test("a number exactly one contact has is that contact", () => {
  assert.deepEqual(phoneMatchIn(rows, "+13238067609"), { kind: "one", leadId: "thelma" });
  // Same number, any way it was typed or imported.
  assert.deepEqual(phoneMatchIn(rows, "323-806-7609"), { kind: "one", leadId: "thelma" });
  assert.deepEqual(phoneMatchIn(rows, "3238067609"), { kind: "one", leadId: "thelma" });
  assert.deepEqual(phoneMatchIn(rows, "1 (323) 806 7609"), { kind: "one", leadId: "thelma" });
});

test("a number two contacts share is 'many', not 'none'", () => {
  const match = phoneMatchIn(rows, "8182687398");
  assert.equal(match.kind, "many");
  assert.deepEqual(match.kind === "many" ? [...match.leadIds].sort() : [], ["jeremy", "sandra"]);
});

test("the second contact's number counts as that contact's", () => {
  assert.deepEqual(phoneMatchIn(rows, "323-777-8888"), { kind: "one", leadId: "carlos" });
});

test("a contact's second and third numbers count as theirs", () => {
  // A cold-call prospect ringing back on any of their three numbers is
  // the same person -- "none" here would make the importer clone them.
  assert.deepEqual(phoneMatchIn(rows, "213-444-1000"), { kind: "one", leadId: "dialed" });
  assert.deepEqual(phoneMatchIn(rows, "(213) 444-2000"), { kind: "one", leadId: "dialed" });
  assert.deepEqual(phoneMatchIn(rows, "+1 213 444 3000"), { kind: "one", leadId: "dialed" });
});

test("one contact holding the same number twice is still one contact", () => {
  const twice: LeadPhoneRow[] = [
    { id: "solo", phone: "213-555-0000", ...bare, second_contact_phone: "+1 213 555 0000" },
  ];
  assert.deepEqual(phoneMatchIn(twice, "2135550000"), { kind: "one", leadId: "solo" });
});

test("a blank or too-short number matches nobody instead of everybody", () => {
  assert.deepEqual(phoneMatchIn(rows, ""), { kind: "none" });
  assert.deepEqual(phoneMatchIn(rows, null), { kind: "none" });
  assert.deepEqual(phoneMatchIn(rows, undefined), { kind: "none" });
  // "short" holds 5551234; asking for it must not match that contact.
  assert.deepEqual(phoneMatchIn(rows, "555-1234"), { kind: "none" });
});

test("the prebuilt index gives the same answers as a straight scan", () => {
  const index = phoneIndex(rows);
  for (const phone of ["3238067609", "8182687398", "3237778888", "310-555-0199", ""]) {
    assert.deepEqual(phoneMatchInIndex(index, phone), phoneMatchIn(rows, phone));
  }
});

test("a contact added mid-sweep is found by the rest of the sweep", () => {
  const index = phoneIndex(rows);
  assert.deepEqual(phoneMatchInIndex(index, "310-555-0199"), { kind: "none" });
  rememberInIndex(index, "+1 310 555 0199", "new-lead");
  assert.deepEqual(phoneMatchInIndex(index, "310-555-0199"), { kind: "one", leadId: "new-lead" });
  // Remembering the same contact twice must not make it look ambiguous.
  rememberInIndex(index, "310-555-0199", "new-lead");
  assert.deepEqual(phoneMatchInIndex(index, "310-555-0199"), { kind: "one", leadId: "new-lead" });
});

test("phoneKey stays in step with normalizePhone in types.ts", () => {
  // phoneKey repeats that rule locally so this module has no runtime
  // imports; if types.ts ever changes, this fails instead of silently
  // splitting contact matching in two.
  for (const input of [
    "+1 323-806-7609",
    "323-806-7609",
    "13238067609",
    "(818) 268-7398",
    "760 790 4576",
    "555-1234",
    "",
  ]) {
    const normalized = normalizePhone(input);
    assert.equal(phoneKey(input), normalized.length >= 10 ? normalized : "");
  }
});

test("soleLeadId keeps the old one-or-nothing behaviour", () => {
  assert.equal(soleLeadId(phoneMatchIn(rows, "3238067609")), "thelma");
  assert.equal(soleLeadId(phoneMatchIn(rows, "8182687398")), null);
  assert.equal(soleLeadId(phoneMatchIn(rows, "310-555-0199")), null);
});
