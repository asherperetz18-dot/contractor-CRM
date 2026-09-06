import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addressLine,
  addressSearches,
  noRecordMessage,
  searchFromSuggestion,
  splitAddress,
  stripUnit,
} from "./property-address.ts";

/**
 * "Check owner & liens" answered "PropertyRadar has no record for this
 * address" for houses that are on file, because it ran one search with
 * Google's city name. These tests pin down the searches that replace it.
 */

const GOOGLE = "1303 W Farlington St, West Covina, CA 91790, USA";

test("a Google address splits into street, city, state and ZIP", () => {
  assert.deepEqual(splitAddress(GOOGLE), {
    street: "1303 W Farlington St",
    city: "West Covina",
    state: "CA",
    zip: "91790",
  });
});

test("no country, ZIP+4, lower-case state and a unit segment all still split", () => {
  assert.deepEqual(splitAddress("4307 Hazeltine Ave, Sherman Oaks, CA 91423"), {
    street: "4307 Hazeltine Ave",
    city: "Sherman Oaks",
    state: "CA",
    zip: "91423",
  });
  assert.equal(splitAddress("1 Main St, Somewhere, ca 90001-1234")?.zip, "90001");
  assert.equal(splitAddress("1 Main St, Somewhere, ca 90001-1234")?.state, "CA");
  // An apartment written as its own segment folds into the street, no comma.
  assert.equal(splitAddress("123 Main St, Apt 4, Los Angeles, CA 90001, USA")?.street, "123 Main St Apt 4");
  // No ZIP at all is still a usable address.
  assert.equal(splitAddress("123 Main St, Los Angeles, CA")?.zip, null);
});

test("an address that can't be taken apart is null, not a wrong split", () => {
  assert.equal(splitAddress("1303 W Farlington St West Covina CA 91790"), null);
  assert.equal(splitAddress("123 Main St, Los Angeles"), null);
  assert.equal(splitAddress("123 Main St, Los Angeles, California 90001"), null);
  assert.equal(splitAddress(""), null);
});

test("stripUnit drops a trailing unit and nothing else", () => {
  assert.equal(stripUnit("1303 W Farlington St Apt 4"), "1303 W Farlington St");
  assert.equal(stripUnit("120 SE Main St #500"), "120 SE Main St");
  assert.equal(stripUnit("120 SE Main St Unit B-2"), "120 SE Main St");
  assert.equal(stripUnit("1303 W Farlington St"), null);
});

test("addressLine is the address without the country", () => {
  assert.equal(addressLine(GOOGLE), "1303 W Farlington St, West Covina, CA 91790");
  assert.equal(addressLine("  "), "");
});

test("searches run most exact first: ZIP, city, full address, then loose ones", () => {
  const searches = addressSearches(GOOGLE);
  assert.deepEqual(
    searches.map((s) => s.label),
    ["ZIP 91790", "West Covina, CA", "the full address", "statewide in CA"]
  );
  assert.deepEqual(searches[0].criteria, [
    { name: "Address", value: ["1303 W Farlington St"] },
    { name: "ZipFive", value: ["91790"] },
  ]);
  assert.deepEqual(searches[1].criteria, [
    { name: "Address", value: ["1303 W Farlington St"] },
    { name: "City", value: ["West Covina"] },
    { name: "State", value: ["CA"] },
  ]);
  assert.deepEqual(searches[2].criteria, [
    { name: "SiteAddress", value: ["1303 W Farlington St, West Covina, CA 91790"] },
  ]);
  // Only the exact searches may take the first hit; statewide must be the only hit.
  assert.deepEqual(
    searches.map((s) => s.mustBeUnique),
    [false, false, false, true]
  );
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
    "the full address",
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
    { name: "State", value: ["OR"] },
  ]);
});

test("an address with no commas still gets the full-string search", () => {
  const searches = addressSearches("1303 W Farlington St West Covina CA 91790");
  assert.deepEqual(searches.map((s) => s.label), ["the full address"]);
  assert.deepEqual(addressSearches(""), []);
});

test("the no-record message names the house, what was tried, and PropertyRadar's complaint", () => {
  const searches = addressSearches(GOOGLE);
  assert.equal(
    noRecordMessage(GOOGLE, searches),
    'PropertyRadar has no record for "1303 W Farlington St" — searched by ZIP 91790, West Covina, CA, the full address and statewide in CA. Check the street number and spelling on the contact.'
  );
  assert.match(noRecordMessage(GOOGLE, searches, "Unknown criteria name"), /PropertyRadar said: "Unknown criteria name"$/);
  assert.match(
    noRecordMessage("1303 W Farlington St West Covina", addressSearches("1303 W Farlington St West Covina")),
    /needs a street, city, state and ZIP separated by commas/
  );
});
