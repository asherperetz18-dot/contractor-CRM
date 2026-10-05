import { STANDARD_WORDS, word, type CompanyWords, type WordForm, type WordKey } from "./company-words.ts";
import { STANDARD_STAGE_NAMES, type StageKey } from "./pipeline/stage-keys.ts";

/**
 * Trade starter setups (DECISIONS #124). A new company picks its trade at
 * sign-up and starts in its own words: the words customers read (#121),
 * the stage names that follow from them, and a few project types. The
 * words per trade are the ones the owner approved on 2026-10-05.
 * Everything stays editable in Settings afterwards. Pure.
 */

export const TRADES = [
  { key: "remodeling", label: "Remodeling" },
  { key: "hvac", label: "HVAC" },
  { key: "plumbing", label: "Plumbing" },
  { key: "roofing", label: "Roofing" },
  { key: "solar", label: "Solar" },
  { key: "other", label: "Other" },
] as const;

export type TradeKey = (typeof TRADES)[number]["key"];

export function isTrade(value: unknown): value is TradeKey {
  return TRADES.some((t) => t.key === value);
}

const pair = (one: string, many: string): WordForm => ({ one, many });

const TRADE_WORDS: Record<TradeKey, Partial<CompanyWords>> = {
  remodeling: {},
  hvac: {
    project: pair("Job", "Jobs"),
    appointment: pair("Service Call", "Service Calls"),
    rep: pair("Technician", "Technicians"),
  },
  plumbing: {
    project: pair("Job", "Jobs"),
    appointment: pair("Service Call", "Service Calls"),
    rep: pair("Technician", "Technicians"),
    contract: pair("Work Authorization", "Work Authorizations"),
  },
  roofing: { appointment: pair("Inspection", "Inspections") },
  solar: {
    estimate: pair("Proposal", "Proposals"),
    appointment: pair("Consultation", "Consultations"),
    rep: pair("Energy Consultant", "Energy Consultants"),
    contract: pair("Agreement", "Agreements"),
  },
  other: {},
};

/** The words a trade starts with -- only those that differ from the standard. */
export function tradeWords(trade: TradeKey): Partial<CompanyWords> {
  return TRADE_WORDS[trade];
}

const differs = (words: CompanyWords, key: WordKey) => words[key].one !== STANDARD_WORDS[key].one;

/**
 * The stage names a company starts with, from its words: an HVAC company
 * gets "Service Call Scheduled", a solar company "Proposal Sent". A stage
 * whose word is the standard one keeps its usual name, so a remodeler's
 * board is exactly as it has always been.
 */
export function tradeStageNames(words: CompanyWords): Record<StageKey, string> {
  const names: Record<StageKey, string> = { ...STANDARD_STAGE_NAMES };
  if (differs(words, "appointment")) {
    const appt = word(words, "appointment");
    names.appointment_scheduled = `${appt} Scheduled`;
    names.appointment_follow_up = `${appt} Follow Up`;
    names.second_appointment = `2nd ${appt}`;
  }
  if (differs(words, "estimate")) {
    const est = word(words, "estimate");
    names.estimate_prepared = `${est} Prepared`;
    names.proposal_sent = `${est} Sent`;
  }
  return names;
}

/** A starter dialer outcome's target stage, renamed with its stage. */
export function tradeDispositionTarget(
  standardName: string | null,
  names: Record<StageKey, string>
): string | null {
  if (!standardName) return null;
  const key = (Object.keys(STANDARD_STAGE_NAMES) as StageKey[]).find((k) => STANDARD_STAGE_NAMES[k] === standardName);
  return key ? names[key] : standardName;
}

const TRADE_PROJECT_TYPES: Record<TradeKey, string[]> = {
  // What every company started with before trades.
  remodeling: ["Kitchen Remodel", "Bathroom Remodel", "Kitchen Cabinets", "Roofing"],
  hvac: ["AC Repair", "AC Installation", "Heating Repair", "Heating Installation"],
  plumbing: ["Leak Repair", "Drain Cleaning", "Water Heater", "Repiping"],
  roofing: ["Roof Repair", "Roof Replacement", "Gutters", "Skylights"],
  solar: ["Solar Panels", "Battery Storage", "Panel Upgrade", "EV Charger"],
  other: ["Repair", "Installation", "Replacement", "Maintenance"],
};

/** Kept short on purpose: only so the dropdown is never empty. */
export function tradeProjectTypes(trade: TradeKey): string[] {
  return TRADE_PROJECT_TYPES[trade];
}
