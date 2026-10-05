import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { US_STATES, signupLocationProblem, timezoneForState } from "./data/us-states.ts";

/**
 * A new company used to start as La Home Contractor's copy: Pacific time,
 * La Home's commission rates (50% rep share, 15% lead cost, 5% closer,
 * 1% dispatcher) and a team map that opened on Los Angeles. It now gives
 * its own state and time zone at sign-up, starts its rates at zero, and
 * its map opens where it is (DECISIONS #118).
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("a state suggests its time zone", () => {
  assert.equal(timezoneForState("CA"), "Pacific");
  assert.equal(timezoneForState("AZ"), "Arizona");
  assert.equal(timezoneForState("TX"), "Central");
  assert.equal(timezoneForState("NY"), "Eastern");
  assert.equal(timezoneForState("HI"), "Hawaii");
  assert.equal(timezoneForState("ZZ"), null);
  for (const s of US_STATES) assert.ok(timezoneForState(s.code), `${s.code} has a zone`);
});

test("sign-up refuses a missing or made-up state or time zone", () => {
  assert.equal(signupLocationProblem("TX", "Central"), null);
  assert.equal(signupLocationProblem("TX", "Eastern"), null); // a company may pick another zone
  assert.match(signupLocationProblem("", "Central") ?? "", /state/i);
  assert.match(signupLocationProblem("XX", "Central") ?? "", /state/i);
  assert.match(signupLocationProblem("TX", "Mars") ?? "", /time zone/i);
});

test("the setup form asks for state and time zone, and the company is made with them", () => {
  const form = read("../app/register/register-form.tsx");
  assert.match(form, /name="state"/);
  assert.match(form, /name="timezone"/);
  const action = read("./actions/signup.ts");
  const start = action.indexOf("export async function completeSignup(");
  const fn = action.slice(start, action.indexOf("\nexport ", start + 1));
  assert.match(fn, /formData\.get\("state"\)/);
  assert.match(fn, /formData\.get\("timezone"\)/);
  assert.match(fn, /signupLocationProblem\(/);
  assert.match(fn, /createCompanyWithDefaults\([\s\S]*?licenseState/);
});

test("a new company's commission rates start at zero, with its own state and time zone", () => {
  const src = read("./signup/provision.ts");
  const start = src.indexOf('admin.from("company_profile").insert({');
  assert.ok(start > 0);
  const insert = src.slice(start, src.indexOf("\n    }),", start));
  for (const col of ["sales_commission_bp", "sales_lead_cost_bp", "default_closer_bp", "dispatcher_commission_bp"]) {
    assert.match(insert, new RegExp(`${col}: 0\\b`), `${col} starts at 0`);
  }
  assert.match(insert, /license_state/);
  assert.match(insert, /options\.timezone/);
});

test("the team map opens on the company, not Los Angeles", () => {
  assert.doesNotMatch(read("../app/(app)/team-map/team-map-view.tsx"), /-118\.25/);
  assert.match(read("../app/(app)/team-map/page.tsx"), /companyAddress=/);
});
