import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateMoneyChip,
  estimateStatusChip,
  journeyProgress,
  socialLinkClass,
} from "./portal-display.ts";

/**
 * The portal's chips are read by colour before they are read by label,
 * so each one's tone is its meaning: blue is the paperwork's state,
 * green is money that came in, amber is money still owed. A chip that
 * changed colour with no change in meaning would teach the customer the
 * wrong thing about their own contract.
 */

test("a signed estimate reads as Signed, in the paperwork colour", () => {
  assert.deepEqual(estimateStatusChip("Signed"), { label: "Signed", tone: "blue" });
});

test("a declined estimate says so, in slate rather than an alarm", () => {
  assert.deepEqual(estimateStatusChip("Declined"), { label: "Declined", tone: "slate" });
});

test("anything not yet signed or declined asks for a signature", () => {
  for (const status of ["Draft", "Sent", "Viewed"]) {
    assert.deepEqual(estimateStatusChip(status), {
      label: "Awaiting your signature",
      tone: "amber",
    });
  }
});

test("a paid deposit is money in: green", () => {
  assert.deepEqual(estimateMoneyChip({ depositPaid: true, amountDueCents: 0 }), {
    label: "Deposit paid",
    tone: "green",
  });
});

test("a deposit still owed names the amount, in amber", () => {
  assert.deepEqual(estimateMoneyChip({ depositPaid: false, amountDueCents: 250000 }), {
    label: "$2,500.00 deposit due",
    tone: "amber",
  });
});

test("money owed wins over an earlier paid flag -- the customer must see what is due", () => {
  assert.equal(
    estimateMoneyChip({ depositPaid: true, amountDueCents: 5000 })?.tone,
    "amber"
  );
});

test("no deposit either way means no money chip", () => {
  assert.equal(estimateMoneyChip({ depositPaid: false, amountDueCents: 0 }), null);
});

test("progress counts the current step, so the last step fills the bar", () => {
  assert.deepEqual(journeyProgress(4, 5), { label: "Step 5 of 5", percent: 100 });
  assert.deepEqual(journeyProgress(0, 5), { label: "Step 1 of 5", percent: 20 });
  assert.deepEqual(journeyProgress(2, 5), { label: "Step 3 of 5", percent: 60 });
});

test("each social network gets its own button colour", () => {
  const labels = ["Facebook", "Instagram", "LinkedIn", "YouTube", "TikTok", "Yelp", "Google Reviews"];
  const classes = labels.map(socialLinkClass);
  assert.equal(new Set(classes).size, labels.length);
  for (const c of classes) assert.match(c, /^portal-social-link portal-social-[a-z]+$/);
});

test("an unknown network still renders as a plain button", () => {
  assert.equal(socialLinkClass("Pinterest"), "portal-social-link");
});
