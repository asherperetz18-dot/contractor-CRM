import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_VALUE,
  contactFilterClauses,
  contactFiltersQuery,
  hasContactFilters,
  mergeFilterOptions,
  openStageSelection,
  parseContactFilters,
} from "./contact-filters.ts";

const NONE = { sources: [], reps: [], stages: [] };
const REP_A = "11111111-1111-1111-1111-111111111111";
const REP_B = "22222222-2222-2222-2222-222222222222";

test("no ticks means no clauses -- the whole book", () => {
  assert.deepEqual(contactFilterClauses(NONE), []);
  assert.equal(hasContactFilters(NONE), false);
});

test("each ticked group is one OR clause, so groups AND together", () => {
  assert.deepEqual(
    contactFilterClauses({ sources: ["Vicidial", "Referral"], reps: [REP_A], stages: ["Unsorted"] }),
    [
      'source.in.("Vicidial","Referral")',
      `assigned_to.in.("${REP_A}")`,
      'stage.in.("Unsorted")',
    ]
  );
});

test("'No source' matches both null and blank; 'Unassigned' matches null", () => {
  assert.deepEqual(contactFilterClauses({ sources: [NO_VALUE], reps: [], stages: [] }), [
    'source.is.null,source.eq.""',
  ]);
  assert.deepEqual(contactFilterClauses({ sources: ["Van Wrap", NO_VALUE], reps: [NO_VALUE, REP_B], stages: [] }), [
    'source.in.("Van Wrap"),source.is.null,source.eq.""',
    `assigned_to.in.("${REP_B}"),assigned_to.is.null`,
  ]);
});

test("values carrying commas, parentheses or quotes can't break out of the list", () => {
  assert.deepEqual(contactFilterClauses({ sources: ['Yelp, Inc (paid) "ads"', "a\\b"], reps: [], stages: [] }), [
    'source.in.("Yelp, Inc (paid) \\"ads\\"","a\\\\b")',
  ]);
});

test("a stage can't be 'nobody' -- the sentinel is dropped there", () => {
  assert.deepEqual(contactFilterClauses({ sources: [], reps: [], stages: [NO_VALUE] }), []);
});

test("the URL round-trips, repeated keys and all", () => {
  const f = { sources: ["Google Ads", "Vicidial"], reps: [NO_VALUE, REP_A], stages: ["Appointment Scheduled"] };
  const qs = contactFiltersQuery(f);
  assert.equal(
    qs,
    `source=Google+Ads&source=Vicidial&rep=${NO_VALUE}&rep=${REP_A}&stage=Appointment+Scheduled`
  );
  const back = Object.fromEntries(
    ["source", "rep", "stage"].map((k) => [k, new URLSearchParams(qs).getAll(k)])
  );
  assert.deepEqual(parseContactFilters(back), f);
  assert.equal(contactFiltersQuery(NONE), "");
});

test("parsing takes Next's searchParams shape and drops junk", () => {
  assert.deepEqual(parseContactFilters({ source: "Referral", rep: undefined, openLead: "x" }), {
    sources: ["Referral"],
    reps: [],
    stages: [],
  });
  assert.deepEqual(parseContactFilters({ stage: ["Won", "", "Won", "Lost"] }), {
    sources: [],
    reps: [],
    stages: ["Won", "Lost"],
  });
  // A server action's input arrives from the browser, so anything can.
  assert.deepEqual(parseContactFilters({ source: 42 as unknown as string }), NONE);
  assert.deepEqual(parseContactFilters(null), NONE);
});

test("parsing caps each group so a crafted request can't build a huge query", () => {
  const many = Array.from({ length: 500 }, (_, i) => `s${i}`);
  assert.equal(parseContactFilters({ source: many }).sources.length, 100);
});

test("options keep the settings order, then add book values A-Z, no dupes or blanks", () => {
  assert.deepEqual(
    mergeFilterOptions(["Referral", "Google Ads"], ["Vicidial", "Google Ads", "", "AI Receptionist", "Vicidial"]),
    ["Referral", "Google Ads", "AI Receptionist", "Vicidial"]
  );
});

test("'With open leads' narrows the current stage ticks to open ones", () => {
  const all = ["Unsorted", "Appointment Scheduled", "Won", "Lost", "DNC"];
  assert.deepEqual(openStageSelection(all, []), ["Unsorted", "Appointment Scheduled"]);
  assert.deepEqual(openStageSelection(all, ["Won", "Unsorted"]), ["Unsorted"]);
});
