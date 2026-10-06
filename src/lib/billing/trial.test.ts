import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TRIAL_DAYS,
  billingNotice,
  extendedTrialEnd,
  isTrialExtension,
  lockReason,
  trialCheckoutOptions,
  trialDaysLeft,
} from "./trial.ts";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const DAY = 86_400_000;
const inDays = (d: number) => new Date(NOW + d * DAY).toISOString();

test("a monthly plan is sold as a 60-day free trial with no card asked for", () => {
  assert.equal(TRIAL_DAYS, 60); // the marketing site promises "First 2 months free, no card up front" (DECISIONS #139)
  assert.deepEqual(trialCheckoutOptions("subscription"), {
    payment_method_collection: "if_required",
    subscription_data: {
      trial_period_days: 60,
      // No card by the end of the trial: Stripe cancels, and the company locks.
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    },
  });
  // A one-off price can't carry a trial; it is sold exactly as before.
  assert.deepEqual(trialCheckoutOptions("payment"), {});
});

test("days left round up, and never go below zero", () => {
  assert.equal(trialDaysLeft(inDays(30), NOW), 30);
  assert.equal(trialDaysLeft(inDays(2.2), NOW), 3);
  assert.equal(trialDaysLeft(inDays(0.1), NOW), 1);
  assert.equal(trialDaysLeft(inDays(-1), NOW), 0);
  assert.equal(trialDaysLeft(null, NOW), null);
  assert.equal(trialDaysLeft("not a date", NOW), null);
});

test("the banner counts down a trial with no card, and says nothing once a card is on file", () => {
  const trial = (d: number | null, cardOnFile: boolean | null = false) => ({
    status: "trialing",
    trialEndsAt: d === null ? null : inDays(d),
    cardOnFile,
  });
  assert.deepEqual(billingNotice(trial(12), NOW), {
    text: "Your free trial ends in 12 days. Add a card to keep using AI Build Pro after that.",
    link: "subscribe",
  });
  assert.match(billingNotice(trial(1), NOW)?.text ?? "", /ends tomorrow\./);
  assert.match(billingNotice(trial(0), NOW)?.text ?? "", /ends today\./);
  // Before migration 0198 there is no end date to count down from.
  assert.match(billingNotice(trial(null), NOW)?.text ?? "", /^You're on a free trial\./);
  assert.equal(billingNotice(trial(12, true), NOW), null);
});

test("a failed payment still warns as before, and a healthy or unbilled company sees nothing", () => {
  assert.deepEqual(billingNotice({ status: "past_due", trialEndsAt: null, cardOnFile: true }, NOW), {
    text: "Your last AI Build Pro payment didn't go through. Update your card to keep access.",
    link: "update",
  });
  assert.equal(billingNotice({ status: "active", trialEndsAt: null, cardOnFile: true }, NOW), null);
  assert.equal(billingNotice(null, NOW), null);
});

test("the lock screen can tell an ended trial from an ended subscription", () => {
  assert.equal(lockReason({ status: "canceled", trialEndsAt: inDays(-1), cardOnFile: false }), "trial_ended");
  // A trial that turned into a paid plan and was cancelled later is a subscription ending.
  assert.equal(lockReason({ status: "canceled", trialEndsAt: inDays(-90), cardOnFile: true }), "subscription_ended");
  assert.equal(lockReason({ status: "unpaid", trialEndsAt: null, cardOnFile: null }), "subscription_ended");
  assert.equal(lockReason(null), "subscription_ended");
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("signup sells the trial; coming back after it ends is a plain paid checkout", () => {
  const signup = source("../actions/signup.ts");
  const create = signup.slice(signup.indexOf("stripe.checkout.sessions.create("));
  assert.match(create.slice(0, create.indexOf("});")), /\.\.\.trialCheckoutOptions\(mode\)/);
  // A second free month for a company whose trial already ran out would be a loophole.
  const billing = source("../actions/billing.ts");
  assert.doesNotMatch(billing, /trialCheckoutOptions|trial_period_days/);
});

test("the trial columns are written on their own, so a missing 0198 never stops the status syncing", () => {
  const sync = source("./company-billing.ts");
  const upsert = sync.indexOf('.from("company_billing").upsert(');
  const trial = sync.indexOf(".update(trial)");
  assert.ok(upsert > 0 && trial > upsert, "status first, trial fields after");
  assert.match(sync, /isMissingSchemaError\(trialError\)/);
  // The read takes every column, so it works before and after 0198.
  assert.match(sync, /\.select\("\*"\)/);
});

test("extending a trial adds the full time, from its end or from now if that has passed", () => {
  const secs = (iso: string) => Date.parse(iso) / 1000;
  // Ends in 5 days, +14: ends in 19 days.
  assert.equal(extendedTrialEnd(inDays(5), NOW, 14), secs(inDays(19)));
  // Already ended yesterday, +7: a week from now, not six days.
  assert.equal(extendedTrialEnd(inDays(-1), NOW, 7), secs(inDays(7)));
  assert.equal(extendedTrialEnd(null, NOW, 30), secs(inDays(30)));
  assert.ok(isTrialExtension(7) && isTrialExtension(14) && isTrialExtension(30));
  assert.ok(!isTrialExtension(365) && !isTrialExtension(0) && !isTrialExtension(-7));
});

test("only a platform admin can extend a trial, checked inside the action itself", () => {
  const action = source("../actions/trial-admin.ts");
  const fn = action.slice(action.indexOf("export async function extendTrial"));
  assert.ok(fn.indexOf("isPlatformAdmin(profile)") > 0);
  assert.ok(fn.indexOf("isPlatformAdmin(profile)") < fn.indexOf("subscriptions.update("));
  assert.match(fn, /isTrialExtension\(days\)/);
});
