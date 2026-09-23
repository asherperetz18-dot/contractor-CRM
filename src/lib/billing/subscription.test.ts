import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BILLING_EVENTS,
  LOCKED_STATUSES,
  billingBanner,
  customerIdFromEvent,
  isBillingLocked,
  pickSubscription,
} from "./subscription.ts";

/**
 * A company that bought AI Build Pros through /get-started is locked out
 * when its subscription lapses. These pin which Stripe statuses count as
 * lapsed, which subscription speaks for a customer that has more than
 * one, and how an event is traced back to the customer it belongs to.
 */

test("only a lapsed subscription locks the company", () => {
  for (const s of ["canceled", "unpaid", "incomplete_expired", "paused"]) {
    assert.equal(isBillingLocked(s), true, s);
  }
  // past_due is Stripe still retrying the card -- a warning, not a lockout.
  for (const s of ["active", "trialing", "past_due", "incomplete"]) {
    assert.equal(isBillingLocked(s), false, s);
  }
});

test("a company with no subscription on record is never locked", () => {
  // Every company made before self-serve signup, or by a manual invite,
  // has no billing status at all -- they must keep working.
  assert.equal(isBillingLocked(null), false);
  assert.equal(isBillingLocked(undefined), false);
  assert.equal(isBillingLocked(""), false);
});

test("the database lock lists exactly the same statuses as the app", () => {
  // RLS is the real boundary and the layout redirect is the friendly
  // one; if the two lists drift, a company is either shown a lock screen
  // over working data or shown the app over empty tables.
  const sql = readFileSync(
    new URL("../../../supabase/migrations/0175_subscription_lockout.sql", import.meta.url),
    "utf8"
  );
  const match = sql.match(/billing_status in \(([^)]*)\)/);
  assert.ok(match, "migration names the locked statuses");
  const inSql = match[1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  assert.deepEqual(inSql, [...LOCKED_STATUSES].sort());
});

test("past_due warns, a lapsed subscription says so, a healthy one says nothing", () => {
  assert.match(billingBanner("past_due") ?? "", /payment/i);
  assert.equal(billingBanner("active"), null);
  assert.equal(billingBanner("trialing"), null);
  assert.equal(billingBanner(null), null);
});

test("the working subscription speaks for the customer over a dead one", () => {
  // Renewing after a cancellation leaves the old canceled subscription
  // on the customer next to the new one. The new one decides.
  const picked = pickSubscription([
    { id: "sub_old", status: "canceled", created: 100 },
    { id: "sub_new", status: "active", created: 200 },
  ]);
  assert.equal(picked?.id, "sub_new");

  // Order in the list must not matter.
  const reversed = pickSubscription([
    { id: "sub_new", status: "active", created: 200 },
    { id: "sub_old", status: "canceled", created: 100 },
  ]);
  assert.equal(reversed?.id, "sub_new");
});

test("an unlocked subscription wins even when a dead one is newer", () => {
  const picked = pickSubscription([
    { id: "sub_live", status: "past_due", created: 100 },
    { id: "sub_dead", status: "incomplete_expired", created: 300 },
  ]);
  assert.equal(picked?.id, "sub_live");
});

test("with only dead subscriptions the newest one is reported", () => {
  const picked = pickSubscription([
    { id: "sub_a", status: "canceled", created: 100 },
    { id: "sub_b", status: "unpaid", created: 200 },
  ]);
  assert.equal(picked?.id, "sub_b");
  assert.equal(pickSubscription([]), null);
});

test("subscription and invoice events are traced to their customer", () => {
  assert.equal(
    customerIdFromEvent({
      type: "customer.subscription.deleted",
      data: { object: { object: "subscription", customer: "cus_1" } },
    }),
    "cus_1"
  );
  assert.equal(
    customerIdFromEvent({
      type: "invoice.payment_failed",
      data: { object: { object: "invoice", customer: { id: "cus_2" } } },
    }),
    "cus_2"
  );
  // Anything else is not a billing event this handler owns.
  assert.equal(
    customerIdFromEvent({
      type: "checkout.session.completed",
      data: { object: { object: "checkout.session", customer: "cus_3" } },
    }),
    null
  );
  assert.equal(
    customerIdFromEvent({
      type: "invoice.paid",
      data: { object: { object: "invoice", customer: null } },
    }),
    null
  );
});

test("the handled events cover renewals, failures and cancellations", () => {
  for (const e of [
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
  ]) {
    assert.ok(BILLING_EVENTS.includes(e), e);
  }
});
