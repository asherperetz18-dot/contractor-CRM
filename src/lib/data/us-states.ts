/**
 * US states, and the time zone each suggests -- used by the account setup
 * form (a new company gives its own state and time zone, DECISIONS #118)
 * and by Settings → Company Profile.
 *
 * Pure, so it is tested on its own (new-company-defaults.test.ts). The
 * zone labels are the ones company_profile.timezone stores; TIMEZONE_IANA
 * in data/types maps each to a real zone.
 */

export const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];

/** The zone most of a state keeps. A suggestion: the company can pick another. */
const STATE_TZ: Record<string, string> = {
  CA: "Pacific", OR: "Pacific", WA: "Pacific", NV: "Pacific",
  AZ: "Arizona", CO: "Mountain", UT: "Mountain", NM: "Mountain", MT: "Mountain", WY: "Mountain", ID: "Mountain",
  TX: "Central", IL: "Central", MO: "Central", MN: "Central", WI: "Central", LA: "Central", OK: "Central",
  KS: "Central", NE: "Central", IA: "Central", AR: "Central", MS: "Central", AL: "Central", TN: "Central",
  SD: "Central", ND: "Central",
  NY: "Eastern", FL: "Eastern", GA: "Eastern", NC: "Eastern", SC: "Eastern", VA: "Eastern", PA: "Eastern",
  OH: "Eastern", MI: "Eastern", NJ: "Eastern", MA: "Eastern", MD: "Eastern", CT: "Eastern", ME: "Eastern",
  NH: "Eastern", VT: "Eastern", RI: "Eastern", DE: "Eastern", WV: "Eastern", KY: "Eastern", IN: "Eastern",
  DC: "Eastern",
  AK: "Alaska", HI: "Hawaii",
};

/** The labels company_profile.timezone accepts. */
export const TIMEZONE_LABELS = ["Pacific", "Mountain", "Arizona", "Central", "Eastern", "Alaska", "Hawaii"];

export function timezoneForState(code: string | null | undefined): string | null {
  return STATE_TZ[(code ?? "").trim().toUpperCase()] ?? null;
}

/** Null when both are real; otherwise what to tell the person. */
export function signupLocationProblem(state: string, timezone: string): string | null {
  if (!US_STATES.some((s) => s.code === state.trim().toUpperCase())) return "Choose your company's state.";
  if (!TIMEZONE_LABELS.includes(timezone)) return "Choose your company's time zone.";
  return null;
}
