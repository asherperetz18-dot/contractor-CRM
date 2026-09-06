/**
 * Turning a contact's address into PropertyRadar searches.
 *
 * Google writes an address as "1303 W Farlington St, West Covina, CA
 * 91790, USA". The county records behind PropertyRadar can file the same
 * house under a different city name (an LA neighborhood vs "Los Angeles",
 * a mail city vs the incorporated one), so one street+city+state search
 * comes back empty for a house that is on file -- "PropertyRadar has no
 * record for this address" on a perfectly good address.
 *
 * So the lookup tries several searches, most exact first: by ZIP, by
 * city, by PropertyRadar's own suggestion for the address, by the full
 * address string, then statewide when the street is unique. Finding the
 * RadarID this way is free (RadarID-only results are never billed), so
 * extra attempts cost nothing; only the one purchase afterwards does.
 */

export type AddressParts = {
  /** Street number, name and any unit, no commas: "1303 W Farlington St". */
  street: string;
  city: string;
  /** Two letters, upper case. */
  state: string;
  /** Five digits, or null when the address has no ZIP. */
  zip: string | null;
};

/** One entry of PropertyRadar's `Criteria` array. */
export type RadarCriterion = { name: string; value: (string | number)[] };

export type RadarSearch = {
  /** Short, for the "we tried X, Y and Z" message: "ZIP 91790". */
  label: string;
  criteria: RadarCriterion[];
  /**
   * Loose searches (no city or ZIP) may hit the same street number in
   * another town; those count only when PropertyRadar finds exactly one.
   */
  mustBeUnique: boolean;
};

/**
 * "1303 W Farlington St, West Covina, CA 91790, USA" into street, city,
 * state and ZIP. Extra segments before the city (an apartment written as
 * its own segment) fold into the street. Null when the pieces can't be
 * told apart -- a single line with no commas, or no "ST 12345" at the end.
 */
export function splitAddress(full: string): AddressParts | null {
  const parts = full
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 3 && /^(usa|united states|us)$/i.test(parts[parts.length - 1])) {
    parts.pop();
  }
  if (parts.length < 3) return null;
  const stateZip = /^([A-Za-z]{2})(?:\s+(\d{5})(?:-\d{4})?)?$/.exec(parts[parts.length - 1]);
  if (!stateZip) return null;
  const city = parts[parts.length - 2];
  const street = parts.slice(0, parts.length - 2).join(" ").replace(/\s+/g, " ");
  if (!street || !city) return null;
  return {
    street,
    city,
    state: stateZip[1].toUpperCase(),
    zip: stateZip[2] ?? null,
  };
}

/**
 * "1303 W Farlington St Apt 4" -> "1303 W Farlington St". Null when the
 * street has no unit to drop, so callers don't repeat a search.
 */
export function stripUnit(street: string): string | null {
  const stripped = street
    .replace(/\s+(?:#\s*|(?:apt|unit|ste|suite|bldg|fl|floor|rm|room|no|number)\.?\s+)[\w-]+$/i, "")
    .trim();
  return stripped && stripped !== street ? stripped : null;
}

/** The address as one line without the country, for the full-string searches. */
export function addressLine(full: string): string {
  return full
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !/^(usa|united states|us)$/i.test(p))
    .join(", ");
}

/**
 * PropertyRadar's SiteAddress suggestion comes back as its own criteria
 * (City, State, ZipFive, and the street as Address). Those are the words
 * PropertyRadar itself uses for the house, which is what makes the search
 * worth trying -- but only when they pin down a street. City+ZIP alone
 * would match every house in the ZIP and hand back a stranger's report.
 */
export function searchFromSuggestion(
  suggestion: { Label?: string; Criteria?: RadarCriterion[] } | null | undefined
): RadarSearch | null {
  if (!suggestion || !Array.isArray(suggestion.Criteria)) return null;
  const criteria = suggestion.Criteria.filter(
    (c) => c && typeof c.name === "string" && Array.isArray(c.value) && c.value.length > 0
  );
  const hasStreet = criteria.some((c) => c.name === "Address" || c.name === "RadarID");
  if (!hasStreet) {
    // Some suggestions carry the street only in the label; lift it out.
    const street = suggestion.Label?.split(",")[0]?.trim();
    if (!street || !/\d/.test(street)) return null;
    criteria.unshift({ name: "Address", value: [street] });
  }
  return { label: "PropertyRadar's own match", criteria, mustBeUnique: false };
}

/**
 * The searches to run, in order. Stops at the first hit; a search that
 * needs a suggestion from PropertyRadar is given by the caller.
 */
export function addressSearches(full: string, suggestion?: RadarSearch | null): RadarSearch[] {
  const parts = splitAddress(full);
  const line = addressLine(full);
  const searches: RadarSearch[] = [];

  if (parts) {
    const street = { name: "Address", value: [parts.street] };
    const state = { name: "State", value: [parts.state] };
    if (parts.zip) {
      searches.push({
        label: `ZIP ${parts.zip}`,
        criteria: [street, { name: "ZipFive", value: [parts.zip] }],
        mustBeUnique: false,
      });
    }
    searches.push({
      label: `${parts.city}, ${parts.state}`,
      criteria: [street, { name: "City", value: [parts.city] }, state],
      mustBeUnique: false,
    });
  }

  if (suggestion) searches.push(suggestion);

  if (line) {
    searches.push({
      label: "the full address",
      criteria: [{ name: "SiteAddress", value: [line] }],
      mustBeUnique: false,
    });
  }

  if (parts) {
    const state = { name: "State", value: [parts.state] };
    searches.push({
      label: `statewide in ${parts.state}`,
      criteria: [{ name: "Address", value: [parts.street] }, state],
      mustBeUnique: true,
    });
    const bare = stripUnit(parts.street);
    if (bare) {
      searches.push({
        label: "without the unit number",
        criteria: [
          { name: "Address", value: [bare] },
          parts.zip ? { name: "ZipFive", value: [parts.zip] } : { name: "City", value: [parts.city] },
          state,
        ],
        mustBeUnique: true,
      });
    }
  }

  return searches;
}

/**
 * What the button shows when every search came back empty: which house,
 * what was tried, what to check -- and PropertyRadar's own words when it
 * complained about a request, so a rejected search never reads as "no
 * record".
 */
export function noRecordMessage(
  full: string,
  searches: RadarSearch[],
  apiMessage?: string | null
): string {
  const parts = splitAddress(full);
  const house = parts ? `"${parts.street}"` : `"${addressLine(full) || full}"`;
  const tried = searches.map((s) => s.label);
  const triedText =
    tried.length > 1
      ? `${tried.slice(0, -1).join(", ")} and ${tried[tried.length - 1]}`
      : tried[0] ?? "the address as written";
  let msg = `PropertyRadar has no record for ${house} — searched by ${triedText}.`;
  msg += parts
    ? " Check the street number and spelling on the contact."
    : " The address needs a street, city, state and ZIP separated by commas.";
  if (apiMessage) msg += ` PropertyRadar said: "${apiMessage}"`;
  return msg;
}
