import { test } from "node:test";
import assert from "node:assert/strict";
import { QUICK_TEXT_DEFAULTS, fillQuickTextVariables } from "./types.ts";

/**
 * The appointment quick texts in the company's own words (DECISIONS
 * #123): a roofer's "on my way to your 10am inspection", a plumber's
 * "your technician" when nobody is assigned yet.
 */

const vars = { firstName: "Jordan", when: "Tue 10am", repName: "", companyName: "Summit Builders Co" };

test("the default texts say the company's word for an appointment", () => {
  const text = fillQuickTextVariables(QUICK_TEXT_DEFAULTS.on_my_way, { ...vars, repName: "Alex", appointmentWord: "inspection" });
  assert.equal(text, "Hi Jordan, this is Alex with Summit Builders Co - on my way to your Tue 10am inspection now!");
  // The standard word when a company hasn't chosen one.
  assert.match(fillQuickTextVariables(QUICK_TEXT_DEFAULTS.reschedule, vars), /reschedule your Tue 10am appointment/);
});

test("with nobody assigned, the rep is the company's word for one", () => {
  assert.match(
    fillQuickTextVariables(QUICK_TEXT_DEFAULTS.confirm, { ...vars, repWord: "technician" }),
    /this is your technician with Summit Builders Co/
  );
  assert.match(fillQuickTextVariables(QUICK_TEXT_DEFAULTS.confirm, vars), /this is your rep with/);
});

test("no default text leaves a placeholder unfilled", () => {
  for (const body of Object.values(QUICK_TEXT_DEFAULTS)) {
    assert.doesNotMatch(fillQuickTextVariables(body, { ...vars, repName: "Alex" }), /\{[a-z_]+\}/);
  }
});
