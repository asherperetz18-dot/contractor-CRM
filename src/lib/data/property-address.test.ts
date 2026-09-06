import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addressLine,
  addressSearches,
  noRecordMessage,
  searchFromSuggestion,
  splitAddress,
  streetNumberAndName,
  stripUnit,
} from "./property-address.ts";

/**
 * "Check owner & liens" answered "PropertyRadar has no record for this
 * address" for houses that are on file: one strict search, one strict
 * address format. These tests pin down the parser that reads every
 * common shape and the searches that replace the single one.
 */

const GOOGLE = "1303 W Farlington St, West Covina, CA 91790, USA";
const TYPED = "10229 Oakdale Ave, Chatsworth CA 91311";

test("a Google address splits into street, city, state and ZIP", () => {
  assert.deepEqual(splitAddress(GOOGLE), {
    street: "1303 W Farlington St",
    city: "West Covina",
    state: "CA",
    zip: "91790",
  });
});

test("a typed address with no comma before the state still splits", () => {
  // The exact card that failed: "Chatsworth CA 91311" in one segment.
  assert.deepEqual(splitAddress(TYPED), {
    street: "10229 Oakdale Ave",
    city: "Chatsworth",
    state: "CA",
    zip: "91311",
  });
  assert.deepEqual(splitAddress("10229 Oakdale Ave, Chatsworth, CA 91311"), splitAddress(TYPED));
  assert.deepEqual(splitAddress("10229 Oakdale Ave, Chatsworth, CA, 91311"), {
    street: "10229 Oakdale Ave",
    city: "Chatsworth",
    state: "CA",
    zip: "91311",
  });
});

test("no commas at all: the street ends at its street-type word", () => {
  assert.deepEqual(splitAddress("10229 Oakdale Ave Chatsworth CA 91311"), {
    street: "10229 Oakdale Ave",
    city: "Chatsworth",
    state: "CA",
    zip: "91311",
  });
  assert.deepEqual(splitAddress("4307 Hazeltine Ave Sherman Oaks CA 91423"), {
    street: "4307 Hazeltine Ave",
    city: "Sherman Oaks",
    state: "CA",
    zip: "91423",
  });
  // A unit after the street type stays with the street.
  assert.deepEqual(splitAddress("120 SE Main St #500 Portland OR 97204")?.street, "120 SE Main St #500");
  assert.deepEqual(splitAddress("120 SE Main St Apt 4 Portland OR 97204")?.city, "Portland");
  // The city rode along in the street segment.
  assert.deepEqual(splitAddress("10229 Oakdale Ave Chatsworth, CA 91311"), {
    street: "10229 Oakdale Ave",
    city: "Chatsworth",
    state: "CA",
    zip: "91311",
  });
});

test("no country, ZIP+4, lower-case state, a unit segment, a missing ZIP or city", () => {
  assert.deepEqual(splitAddress("4307 Hazeltine Ave, Sherman Oaks, CA 91423"), {
    street: "4307 Hazeltine Ave",
    city: "Sherman Oaks",
    state: "CA",
    zip: "91423",
  });
  assert.equal(splitAddress("1 Main St, Somewhere, ca 90001-1234")?.zip, "90001");
  assert.equal(splitAddress("1 Main St, Somewhere, ca 90001-1234")?.state, "CA");
  assert.equal(splitAddress("123 Main St, Apt 4, Los Angeles, CA 90001, USA")?.street, "123 Main St Apt 4");
  assert.deepEqual(splitAddress("123 Main St, Los Angeles, CA"), {
    street: "123 Main St",
    city: "Los Angeles",
    state: "CA",
    zip: null,
  });
  assert.deepEqual(splitAddress("123 Main St, CA 90001"), {
    street: "123 Main St",
    city: null,
    state: "CA",
    zip: "90001",
  });
  assert.deepEqual(splitAddress("123 Main St, Chatsworth, 91311"), {
    street: "123 Main St",
    city: "Chatsworth",
    state: null,
    zip: "91311",
  });
  // A spelled-out state.
  assert.deepEqual(splitAddress("123 Main St, Los Angeles, California 90001"), {
    street: "123 Main St",
    city: "Los Angeles",
    state: "CA",
    zip: "90001",
  });
  assert.equal(splitAddress("1 Main St, Brooklyn, New York 11201")?.state, "NY");
  assert.equal(splitAddress("1 Main St, Brooklyn, New York 11201")?.city, "Brooklyn");
});

test("an address that can't be taken apart is null, not a wrong split", () => {
  assert.equal(splitAddress("123 Main St, Los Angeles"), null); // no state, no ZIP
  assert.equal(splitAddress("1 Main St, Santa Fe"), null); // "Fe" is not a state
  assert.equal(splitAddress("Chatsworth, CA 91311"), null); // no street number
  assert.equal(splitAddress("10229 Oakdale Chatsworth CA 91311"), null); // no street type to cut at
  assert.equal(splitAddress("91311"), null);
  assert.equal(splitAddress(""), null);
});

test("stripUnit drops a trailing unit and nothing else", () => {
  assert.equal(stripUnit("1303 W Farlington St Apt 4"), "1303 W Farlington St");
  assert.equal(stripUnit("120 SE Main St #500"), "120 SE Main St");
  assert.equal(stripUnit("120 SE Main St Unit B-2"), "120 SE Main St");
  assert.equal(stripUnit("1303 W Farlington St"), null);
});

test("streetNumberAndName keeps only the number and the name", () => {
  assert.deepEqual(streetNumberAndName("10229 Oakdale Ave"), { number: 10229, name: "Oakdale" });
  assert.deepEqual(streetNumberAndName("1303 W Farlington St"), { number: 1303, name: "Farlington" });
  assert.deepEqual(streetNumberAndName("120 SE Main St #500"), { number: 120, name: "Main" });
  assert.deepEqual(streetNumberAndName("4307 Hazeltine Ave"), { number: 4307, name: "Hazeltine" });
  assert.deepEqual(streetNumberAndName("1 Avenue of the Stars"), { number: 1, name: "Avenue of the Stars" });
  assert.equal(streetNumberAndName("One Wilshire"), null);
});

test("addressLine is the address without the country", () => {
  assert.equal(addressLine(GOOGLE), "1303 W Farlington St, West Covina, CA 91790");
  assert.equal(addressLine("  "), "");
});

test("searches run most exact first: ZIP, city, number+name, then statewide", () => {
  const searches = addressSearches(TYPED);
  assert.deepEqual(
    searches.map((s) => s.label),
    ["ZIP 91311", "Chatsworth, CA", "street number and name in ZIP 91311", "statewide in CA"]
  );
  assert.deepEqual(searches[0].criteria, [
    { name: "Address", value: ["10229 Oakdale Ave"] },
    { name: "ZipFive", value: ["91311"] },
  ]);
  assert.deepEqual(searches[1].criteria, [
    { name: "Address", value: ["10229 Oakdale Ave"] },
    { name: "City", value: ["Chatsworth"] },
    { name: "State", value: ["CA"] },
  ]);
  assert.deepEqual(searches[2].criteria, [
    { name: "SiteNumber", value: [[10229, 10229]] },
    { name: "SiteStreetName", value: ["Oakdale"] },
    { name: "ZipFive", value: ["91311"] },
  ]);
  assert.deepEqual(searches[3].criteria, [
    { name: "Address", value: ["10229 Oakdale Ave"] },
    { name: "State", value: ["CA"] },
  ]);
  // Only the exact searches may take the first hit; the loose ones must be the only hit.
  assert.deepEqual(
    searches.map((s) => s.mustBeUnique),
    [false, false, true, true]
  );
  // SiteAddress is never sent: the API rejects it as an output-only field.
  for (const s of searches) {
    assert.ok(!s.criteria.some((c) => c.name === "SiteAddress"), s.label);
  }
});

test("PropertyRadar's own suggestion slots in after the city search", () => {
  const suggestion = searchFromSuggestion({
    Label: "1303 W FARLINGTON ST, WEST COVINA, CA 91790",
    Criteria: [
      { name: "Address", value: ["1303 W FARLINGTON ST"] },
      { name: "City", value: ["West Covina"] },
      { name: "State", value: ["CA"] },
      { name: "ZipFive", value: [91790] },
    ],
  });
  assert.ok(suggestion);
  const labels = addressSearches(GOOGLE, suggestion).map((s) => s.label);
  assert.deepEqual(labels, [
    "ZIP 91790",
    "West Covina, CA",
    "PropertyRadar's own match",
    "street number and name in ZIP 91790",
    "statewide in CA",
  ]);
});

test("a suggestion that doesn't name a street is refused -- it would match a whole ZIP", () => {
  assert.equal(
    searchFromSuggestion({
      Label: "WEST COVINA, CA 91790",
      Criteria: [
        { name: "City", value: ["West Covina"] },
        { name: "State", value: ["CA"] },
        { name: "ZipFive", value: [91790] },
      ],
    }),
    null
  );
  // The street may live only in the label; then it is lifted into the criteria.
  const lifted = searchFromSuggestion({
    Label: "1303 W FARLINGTON ST, WEST COVINA, CA 91790",
    Criteria: [
      { name: "City", value: ["West Covina"] },
      { name: "ZipFive", value: [91790] },
    ],
  });
  assert.deepEqual(lifted?.criteria[0], { name: "Address", value: ["1303 W FARLINGTON ST"] });
  assert.equal(searchFromSuggestion(null), null);
  assert.equal(searchFromSuggestion({ Label: "x" }), null);
});

test("a unit gets one extra loose search, by ZIP, that must be unique", () => {
  const searches = addressSearches("120 SE Main St #500, Portland, OR 97204, USA");
  const last = searches[searches.length - 1];
  assert.equal(last.label, "without the unit number");
  assert.equal(last.mustBeUnique, true);
  assert.deepEqual(last.criteria, [
    { name: "Address", value: ["120 SE Main St"] },
    { name: "ZipFive", value: ["97204"] },
  ]);
});

test("a card with no ZIP or no city still gets the searches it can", () => {
  assert.deepEqual(
    addressSearches("123 Main St, Los Angeles, CA").map((s) => s.label),
    ["Los Angeles, CA", "street number and name in Los Angeles, CA", "statewide in CA"]
  );
  assert.deepEqual(
    addressSearches("123 Main St, CA 90001").map((s) => s.label),
    ["ZIP 90001", "street number and name in ZIP 90001", "statewide in CA"]
  );
});

test("an unreadable address gets only PropertyRadar's suggestion, or nothing", () => {
  assert.deepEqual(addressSearches("123 Main St, Los Angeles"), []);
  const suggestion = { label: "PropertyRadar's own match", criteria: [], mustBeUnique: false };
  assert.deepEqual(addressSearches("123 Main St, Los Angeles", suggestion), [suggestion]);
  assert.deepEqual(addressSearches(""), []);
});

test("the no-record message names the house, what was tried, and PropertyRadar's complaint", () => {
  const searches = addressSearches(TYPED);
  assert.equal(
    noRecordMessage(TYPED, searches),
    'PropertyRadar has no record for "10229 Oakdale Ave" — searched by ZIP 91311, Chatsworth, CA, street number and name in ZIP 91311 and statewide in CA. Check the street number and spelling on the contact.'
  );
  assert.match(
    noRecordMessage(TYPED, searches, "Unknown criteria name"),
    /PropertyRadar said: "Unknown criteria name"$/
  );
  assert.equal(
    noRecordMessage("123 Main St, Los Angeles", []),
    'Couldn\'t tell the street, city, state and ZIP apart in "123 Main St, Los Angeles". Write the address as street, city, state ZIP — for example "123 Main St, Los Angeles, CA 90001" — and try again.'
  );
});
