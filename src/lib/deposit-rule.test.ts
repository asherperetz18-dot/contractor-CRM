import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  depositRuleProblem,
  depositRuleSentence,
  isCaliforniaState,
  parseDepositRule,
} from "./deposit-rule.ts";

/**
 * The deposit asked at signing used to be California's limit -- 10% or
 * $1,000, whichever is less -- for every company, wherever it worked.
 * It is now each company's setting (Settings → Contracts), copied onto
 * each new estimate. A California company still can't set more than the
 * law allows (DECISIONS #117).
 */

test("a deposit rule is typed as a percent and an optional dollar cap", () => {
  assert.deepEqual(parseDepositRule("10", "1,000"), { rule: { percentBp: 1000, capCents: 100000 } });
  assert.deepEqual(parseDepositRule("33.33", ""), { rule: { percentBp: 3333, capCents: 0 } });
  assert.deepEqual(parseDepositRule("0", "$500.50"), { rule: { percentBp: 0, capCents: 50050 } });
  assert.ok("error" in parseDepositRule("abc", ""));
  assert.ok("error" in parseDepositRule("120", ""));
  assert.ok("error" in parseDepositRule("10", "-5"));
});

test("California's limit holds only for a California company", () => {
  assert.equal(isCaliforniaState("CA"), true);
  assert.equal(isCaliforniaState(" california "), true);
  assert.equal(isCaliforniaState("NV"), false);
  assert.equal(isCaliforniaState(null), false);

  const third = { percentBp: 3333, capCents: 0 };
  assert.equal(depositRuleProblem(third, "TX"), null);
  assert.equal(depositRuleProblem(third, null), null);
  assert.match(depositRuleProblem(third, "CA") ?? "", /California/);
  assert.match(depositRuleProblem({ percentBp: 1000, capCents: 150000 }, "CA") ?? "", /\$1,000/);
  assert.equal(depositRuleProblem({ percentBp: 1000, capCents: 100000 }, "CA"), null);
  assert.equal(depositRuleProblem({ percentBp: 500, capCents: 50000 }, "California"), null);
});

test("the rule reads as one plain sentence", () => {
  assert.equal(depositRuleSentence({ percentBp: 1000, capCents: 100000 }), "10% of the total, up to $1,000");
  assert.equal(depositRuleSentence({ percentBp: 2500, capCents: 0 }), "25% of the total, with no cap");
  assert.equal(depositRuleSentence({ percentBp: 0, capCents: 0 }), "no deposit");
});

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("a new estimate takes the company's deposit rule", () => {
  const src = read("./actions/estimates.ts");
  const start = src.indexOf('.from("estimates")\n    .insert({');
  assert.ok(start > 0, "the create insert is found");
  const insert = src.slice(start, src.indexOf("})", start));
  assert.match(insert, /deposit_percent_bp:/);
  assert.match(insert, /deposit_cap_cents:/);
  assert.match(src, /select\(\s*"[^"]*deposit_percent_bp, deposit_cap_cents/);
});

test("only an admin saves the rule, and it is checked first", () => {
  const src = read("./actions/settings.ts");
  const start = src.indexOf("export async function saveDepositRule(");
  assert.ok(start > 0);
  const fn = src.slice(start, src.indexOf("\nexport ", start + 1));
  assert.match(fn, /isAdminRole\(/);
  assert.match(fn, /depositRuleProblem\(/);
});

test("nothing a company sees assumes it is in California", () => {
  const certificate = read("./contracts/completion.ts");
  const body = certificate.slice(certificate.indexOf("export const DEFAULT_COMPLETION_CERTIFICATE"));
  assert.doesNotMatch(body, /CSLB|California/);
  assert.doesNotMatch(read("./data/company-docs.ts"), /CSLB/);
  assert.doesNotMatch(read("../app/(app)/settings/vendors/vendors-view.tsx"), /placeholder="CSLB/);
});

test("screens describe the estimate's own rule, never a fixed 10% / $1,000", () => {
  for (const file of ["../app/(app)/estimates/[id]/payment-schedule.tsx", "./actions/manual-payments.ts"]) {
    const src = read(file);
    assert.doesNotMatch(src, /10% or \$1,000/, file);
    assert.doesNotMatch(src, /or up to\{" "\}/, file);
    assert.match(src, /depositRuleSentence\(/, file);
  }
});
