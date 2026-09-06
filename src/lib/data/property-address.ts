/**
 * Turning a contact's address into PropertyRadar searches.
 *
 * Addresses on a card come from Google ("1303 W Farlington St, West
 * Covina, CA 91790, USA"), from a CSV, or typed by hand ("10229 Oakdale
 * Ave, Chatsworth CA 91311" -- no comma before the state, no country).
 * The county records behind PropertyRadar can also file a house under a
 * different city name than the card (an LA neighborhood vs "Los Angeles",
 * a mail city vs the incorporated one). So one street+city+state search
 * in one strict format came back "PropertyRadar has no record for this
 * address" on perfectly good addresses.
 *
 * The parser here reads every common shape, and the lookup tries several
 * searches, most exact first: by ZIP, by city, by PropertyRadar's own
 * suggestion for the address, by street number + street name, then
 * statewide when the street is unique. Finding the RadarID this way is
 * free (RadarID-only results are never billed), so extra attempts cost
 * nothing; only the one purchase afterwards does.
 */

export type AddressParts = {
  /** Street number, name and any unit, no commas: "1303 W Farlington St". */
  street: string;
  /** Null when the card has none ("123 Main St, CA 90001"). */
  city: string | null;
  /** Two letters, upper case; null when the card has none. */
  state: string | null;
  /** Five digits, or null when the address has no ZIP. */
  zip: string | null;
};

/** One entry of PropertyRadar's `Criteria` array. A range is `[[from, to]]`. */
export type RadarCriterion = { name: string; value: (string | number | (number | null)[])[] };

export type RadarSearch = {
  /** Short, for the "we tried X, Y and Z" message: "ZIP 91790". */
  label: string;
  criteria: RadarCriterion[];
  /**
   * Loose searches (no city or ZIP, or no street type) may hit the same
   * street number elsewhere; those count only when PropertyRadar finds
   * exactly one.
   */
  mustBeUnique: boolean;
};

const COUNTRY = /^(usa|u\.s\.a\.?|us|united states( of america)?)$/i;

const STATES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
    " "
  )
);

/** Spelled-out states, for "Chatsworth, California 91311". Longest names first. */
const STATE_NAMES: [string, string][] = [
  ["district of columbia", "DC"], ["north carolina", "NC"], ["south carolina", "SC"],
  ["new hampshire", "NH"], ["massachusetts", "MA"], ["west virginia", "WV"],
  ["north dakota", "ND"], ["south dakota", "SD"], ["pennsylvania", "PA"],
  ["rhode island", "RI"], ["connecticut", "CT"], ["mississippi", "MS"],
  ["new jersey", "NJ"], ["new mexico", "NM"], ["washington", "WA"],
  ["california", "CA"], ["minnesota", "MN"], ["wisconsin", "WI"],
  ["tennessee", "TN"], ["louisiana", "LA"], ["new york", "NY"],
  ["oklahoma", "OK"], ["nebraska", "NE"], ["arkansas", "AR"],
  ["colorado", "CO"], ["delaware", "DE"], ["illinois", "IL"],
  ["kentucky", "KY"], ["maryland", "MD"], ["michigan", "MI"],
  ["missouri", "MO"], ["virginia", "VA"], ["alabama", "AL"],
  ["arizona", "AZ"], ["florida", "FL"], ["georgia", "GA"],
  ["indiana", "IN"], ["montana", "MT"], ["vermont", "VT"],
  ["wyoming", "WY"], ["alaska", "AK"], ["hawaii", "HI"],
  ["kansas", "KS"], ["nevada", "NV"], ["oregon", "OR"],
  ["idaho", "ID"], ["maine", "ME"], ["texas", "TX"],
  ["iowa", "IA"], ["ohio", "OH"], ["utah", "UT"],
];

const DIRECTIONS = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);

/** Words that end a street name: the "St" in "10229 Oakdale Ave Chatsworth". */
const STREET_TYPES = new Set(
  "st street ave avenue blvd boulevard dr drive rd road ln lane ct court way pl place cir circle ter terrace hwy highway pkwy parkway trl trail loop sq square aly alley plz plaza path row walk run xing crossing pt point cv cove hts heights vis vista ests estates mnr manor lndg landing cmn common cmns commons".split(
    " "
  )
);

const UNIT_WORDS = new Set(["#", "apt", "unit", "ste", "suite", "bldg", "fl", "floor", "rm", "room", "no", "number"]);

const bare = (word: string) => word.toLowerCase().replace(/\.$/, "");

/**
 * "10229 Oakdale Ave Chatsworth" -> street "10229 Oakdale Ave", city
 * "Chatsworth": the street ends at its last street-type word (plus a
 * trailing direction or unit). Null when there is no such word to cut at.
 */
function splitStreetCity(text: string): { street: string; city: string | null } | null {
  const words = text.split(/\s+/).filter(Boolean);
  let end = -1;
  for (let i = words.length - 1; i >= 2; i--) {
    if (STREET_TYPES.has(bare(words[i]))) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  if (end + 1 < words.length && DIRECTIONS.has(bare(words[end + 1]))) end++;
  if (end + 1 < words.length && words[end + 1].startsWith("#")) {
    end += words[end + 1].length > 1 ? 1 : 2;
  } else if (end + 2 < words.length && UNIT_WORDS.has(bare(words[end + 1]))) {
    end += 2;
  }
  const street = words.slice(0, end + 1).join(" ");
  const city = words.slice(end + 1).join(" ") || null;
  return { street, city };
}

/**
 * Any of these into street, city, state and ZIP:
 *   "1303 W Farlington St, West Covina, CA 91790, USA"   (Google)
 *   "10229 Oakdale Ave, Chatsworth CA 91311"             (typed)
 *   "10229 Oakdale Ave Chatsworth CA 91311"              (no commas at all)
 *   "123 Main St, Apt 4, Los Angeles, CA 90001"          (unit as its own segment)
 * The state and ZIP are read off the end; what remains before them is
 * the city, and everything before that is the street. Null when the
 * street can't be told from the rest -- then the message asks for commas.
 */
export function splitAddress(full: string): AddressParts | null {
  const segs = full
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (segs.length > 1 && COUNTRY.test(segs[segs.length - 1])) segs.pop();
  if (!segs.length) return null;

  // Peel the ZIP, then the state, off the end. Each may share a segment
  // with what precedes it ("Chatsworth CA 91311") or sit in its own.
  let last = segs.pop() as string;
  let zip: string | null = null;
  let state: string | null = null;
  const zipMatch = /^(.*?)\s*\b(\d{5})(?:-\d{4})?$/.exec(last);
  if (zipMatch) {
    zip = zipMatch[2];
    last = zipMatch[1].trim();
    if (!last && segs.length) last = segs.pop() as string;
  }
  const stateMatch = /^(.*?)\s*\b([A-Za-z]{2})\.?$/.exec(last);
  if (stateMatch && STATES.has(stateMatch[2].toUpperCase())) {
    state = stateMatch[2].toUpperCase();
    last = stateMatch[1].trim();
  } else {
    const lower = last.toLowerCase();
    for (const [name, code] of STATE_NAMES) {
      if (lower === name || lower.endsWith(` ${name}`)) {
        state = code;
        last = last.slice(0, last.length - name.length).trim();
        break;
      }
    }
  }
  if (state && !last && segs.length) last = segs.pop() as string;
  if (!zip && !state) return null;

  // What's left: the street segments, then the city -- or, with no
  // commas, "10229 Oakdale Ave Chatsworth" to cut at the street type.
  let street: string;
  let city: string | null;
  if (segs.length) {
    street = segs.join(" ");
    city = last || null;
  } else {
    const cut = splitStreetCity(last);
    if (!cut) return null;
    street = cut.street;
    city = cut.city;
  }
  street = street.replace(/\s+/g, " ").trim();
  if (!street || !/\d/.test(street)) return null;
  return { street, city, state, zip };
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

/**
 * "1303 W Farlington St" -> number 1303, name "Farlington": the two
 * pieces PropertyRadar's SiteNumber and SiteStreetName criteria take,
 * which match however the county spells the type ("Ave" vs "Avenue")
 * and the direction. Null when the street doesn't start with a number.
 */
export function streetNumberAndName(street: string): { number: number; name: string } | null {
  const m = /^(\d+)\s+(.+)$/.exec(stripUnit(street) ?? street);
  if (!m) return null;
  const words = m[2].split(/\s+/);
  if (words.length > 1 && DIRECTIONS.has(bare(words[0]))) words.shift();
  if (words.length > 1 && DIRECTIONS.has(bare(words[words.length - 1]))) words.pop();
  if (words.length > 1 && STREET_TYPES.has(bare(words[words.length - 1]))) words.pop();
  const name = words.join(" ").trim();
  return name ? { number: Number(m[1]), name } : null;
}

/** The address as one line without the country, for the suggestion lookup. */
export function addressLine(full: string): string {
  return full
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !COUNTRY.test(p))
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
 * needs a suggestion from PropertyRadar is given by the caller. (Not
 * here: PropertyRadar's "SiteAddress" -- its docs list it as a criterion,
 * but the API answers "SiteAddress is an output field, but cannot be used
 * as a criterion".)
 */
export function addressSearches(full: string, suggestion?: RadarSearch | null): RadarSearch[] {
  const parts = splitAddress(full);
  const searches: RadarSearch[] = [];
  if (!parts) return suggestion ? [suggestion] : [];

  const street = { name: "Address", value: [parts.street] };
  const state = parts.state ? [{ name: "State", value: [parts.state] }] : [];
  // Where the house is, tightest first: the ZIP, else the city and state.
  const place = parts.zip
    ? [{ name: "ZipFive", value: [parts.zip] }]
    : parts.city
      ? [{ name: "City", value: [parts.city] }, ...state]
      : state;
  const placeLabel = parts.zip
    ? `ZIP ${parts.zip}`
    : parts.city
      ? `${parts.city}${parts.state ? `, ${parts.state}` : ""}`
      : `statewide in ${parts.state}`;

  if (parts.zip) {
    searches.push({
      label: `ZIP ${parts.zip}`,
      criteria: [street, { name: "ZipFive", value: [parts.zip] }],
      mustBeUnique: false,
    });
  }
  if (parts.city) {
    searches.push({
      label: `${parts.city}${parts.state ? `, ${parts.state}` : ""}`,
      criteria: [street, { name: "City", value: [parts.city] }, ...state],
      mustBeUnique: false,
    });
  }

  if (suggestion) searches.push(suggestion);

  const numbered = streetNumberAndName(parts.street);
  if (numbered) {
    searches.push({
      label: `street number and name in ${placeLabel}`,
      criteria: [
        { name: "SiteNumber", value: [[numbered.number, numbered.number]] },
        { name: "SiteStreetName", value: [numbered.name] },
        ...place,
      ],
      mustBeUnique: true,
    });
  }

  if (parts.state) {
    searches.push({
      label: `statewide in ${parts.state}`,
      criteria: [street, ...state],
      mustBeUnique: true,
    });
  }
  const bareStreet = stripUnit(parts.street);
  if (bareStreet && place.length) {
    searches.push({
      label: "without the unit number",
      criteria: [{ name: "Address", value: [bareStreet] }, ...place],
      mustBeUnique: true,
    });
  }

  return searches;
}

/**
 * What the button shows when every search came back empty: which house,
 * what was tried, what to check -- and PropertyRadar's own words when it
 * refused the requests, so a rejected search never reads as "no record".
 */
export function noRecordMessage(
  full: string,
  searches: RadarSearch[],
  apiMessage?: string | null
): string {
  const parts = splitAddress(full);
  const line = addressLine(full) || full.trim();
  let msg: string;
  if (parts) {
    const tried = searches.map((s) => s.label);
    const triedText =
      tried.length > 1
        ? `${tried.slice(0, -1).join(", ")} and ${tried[tried.length - 1]}`
        : (tried[0] ?? "the address as written");
    msg = `PropertyRadar has no record for "${parts.street}" — searched by ${triedText}. Check the street number and spelling on the contact.`;
  } else {
    msg = `Couldn't tell the street, city, state and ZIP apart in "${line}". Write the address as street, city, state ZIP — for example "123 Main St, Los Angeles, CA 90001" — and try again.`;
  }
  if (apiMessage) msg += ` PropertyRadar said: "${apiMessage}"`;
  return msg;
}
