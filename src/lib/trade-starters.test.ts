import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  TRADES,
  isTrade,
  tradeDispositionTarget,
  tradeProjectTypes,
  tradeStageNames,
  tradeWords,
} from "./trade-starters.ts";
import { STANDARD_WORDS, readCompanyWords, wordProblem } from "./company-words.ts";
import { STAGE_KEYS, STANDARD_STAGE_NAMES } from "./pipeline/stage-keys.ts";

/**
 * A new company picks its trade at sign-up and starts in its own words
 * (DECISIONS #124): an HVAC company's board says "Service Call
 * Scheduled", a solar company sends Proposals. Everything stays
 * editable in Settings afterwards.
 */

test("six trades, the approved five plus Other", () => {
  assert.deepEqual(
    TRADES.map((t) => t.label),
    ["Remodeling", "HVAC", "Plumbing", "Roofing", "Solar", "Other"]
  );
  assert.equal(isTrade("hvac"), true);
  assert.equal(isTrade("general"), false);
  assert.equal(isTrade(""), false);
});

test("each trade's words are the ones approved, and valid", () => {
  assert.deepEqual(tradeWords("remodeling"), {});
  assert.deepEqual(tradeWords("other"), {});
  const ones = (t: Parameters<typeof tradeWords>[0]) =>
    Object.fromEntries(Object.entries(tradeWords(t)).map(([k, v]) => [k, v!.one]));
  assert.deepEqual(ones("hvac"), { project: "Job", appointment: "Service Call", rep: "Technician" });
  assert.deepEqual(ones("plumbing"), {
    project: "Job",
    appointment: "Service Call",
    rep: "Technician",
    contract: "Work Authorization",
  });
  assert.deepEqual(ones("roofing"), { appointment: "Inspection" });
  assert.deepEqual(ones("solar"), {
    estimate: "Proposal",
    appointment: "Consultation",
    rep: "Energy Consultant",
    contract: "Agreement",
  });
  for (const t of TRADES) {
    for (const form of Object.values(tradeWords(t.key))) assert.equal(wordProblem(form!), null);
  }
});

test("a trade's stages follow its words; the rest keep their standard names", () => {
  const hvac = tradeStageNames(readCompanyWords(tradeWords("hvac")));
  assert.equal(hvac.appointment_scheduled, "Service Call Scheduled");
  assert.equal(hvac.appointment_follow_up, "Service Call Follow Up");
  assert.equal(hvac.second_appointment, "2nd Service Call");
  assert.equal(hvac.won, "Won");
  const solar = tradeStageNames(readCompanyWords(tradeWords("solar")));
  assert.equal(solar.estimate_prepared, "Proposal Prepared");
  assert.equal(solar.proposal_sent, "Proposal Sent");
  assert.equal(solar.appointment_scheduled, "Consultation Scheduled");
  // Remodeling and Other start exactly as every company always has.
  assert.deepEqual(tradeStageNames(STANDARD_WORDS), STANDARD_STAGE_NAMES);
  // Every trade: one name per tag, none repeated.
  for (const t of TRADES) {
    const names = Object.values(tradeStageNames(readCompanyWords(tradeWords(t.key))));
    assert.equal(names.length, STAGE_KEYS.length);
    assert.equal(new Set(names).size, names.length, t.key);
  }
});

test("dialer outcomes point at the trade's own stage names", () => {
  const names = tradeStageNames(readCompanyWords(tradeWords("roofing")));
  assert.equal(tradeDispositionTarget("Appointment Scheduled", names), "Inspection Scheduled");
  assert.equal(tradeDispositionTarget("No Answer", names), "No Answer");
  assert.equal(tradeDispositionTarget(null, names), null);
});

test("each trade starts with a few project types of its own", () => {
  assert.deepEqual(tradeProjectTypes("hvac"), ["AC Repair", "AC Installation", "Heating Repair", "Heating Installation"]);
  assert.ok(tradeProjectTypes("remodeling").includes("Kitchen Remodel"));
  for (const t of TRADES) assert.ok(tradeProjectTypes(t.key).length >= 3, t.key);
});

test("sign-up asks for the trade, and checks it before the setup link is spent", () => {
  const form = readFileSync(new URL("../app/register/register-form.tsx", import.meta.url), "utf8");
  assert.match(form, /name="trade" required/);
  const signup = readFileSync(new URL("./actions/signup.ts", import.meta.url), "utf8");
  const checked = signup.indexOf("isTrade(trade)");
  assert.ok(checked > 0, "the trade is validated");
  assert.ok(checked < signup.indexOf("claimInvite(invite.id)"), "before the one-use link is claimed");
  const provision = readFileSync(new URL("./signup/provision.ts", import.meta.url), "utf8");
  assert.match(provision, /seedRowsFor\(options\.sourceCompanyId, options\.trade\)/);
});
