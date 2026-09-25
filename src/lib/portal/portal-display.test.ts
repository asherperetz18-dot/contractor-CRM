import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billedPhaseDueCents,
  estimateMoneyChip,
  estimateStatusChip,
  invoiceMoneyChip,
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

// The bug this pins: deposit paid, completion phase billed for $6,570 --
// and the portal home said "✓ Deposit paid" in green, as if nothing
// were owed. A billed phase is money due, same as a deposit.
test("a billed phase is money due, even once the deposit is paid", () => {
  assert.deepEqual(
    estimateMoneyChip({ depositPaid: true, amountDueCents: 0, phaseDueCents: 657_000 }),
    { label: "$6,570.00 due", tone: "amber" }
  );
});

test("a deposit and a billed phase both owed read as one total", () => {
  assert.deepEqual(
    estimateMoneyChip({ depositPaid: false, amountDueCents: 73_000, phaseDueCents: 657_000 }),
    { label: "$7,300.00 due", tone: "amber" }
  );
});

const billed = { id: "p1", amount_cents: 657_000, requested_at: "2026-09-24T10:00:00Z", due_date: "2026-10-01" };
const today = new Date("2026-09-25T12:00:00");

test("a billed, unpaid phase owes its full amount", () => {
  assert.equal(billedPhaseDueCents([billed], [], today), 657_000);
});

test("an unbilled phase owes nothing yet -- the work isn't done", () => {
  assert.equal(billedPhaseDueCents([{ ...billed, requested_at: null }], [], today), 0);
});

test("a paid phase owes nothing, and a part-paid one owes the rest", () => {
  assert.equal(
    billedPhaseDueCents([billed], [{ estimate_payment_id: "p1", status: "succeeded", amount_cents: 657_000 }], today),
    0
  );
  assert.equal(
    billedPhaseDueCents([billed], [{ estimate_payment_id: "p1", status: "succeeded", amount_cents: 157_000 }], today),
    500_000
  );
});

test("a phase whose bank transfer is clearing is not asked for again", () => {
  assert.equal(
    billedPhaseDueCents([billed], [{ estimate_payment_id: "p1", status: "pending", amount_cents: 657_000 }], today),
    0
  );
});

test("payments filed to another phase don't count against this one", () => {
  assert.equal(
    billedPhaseDueCents([billed], [{ estimate_payment_id: "other", status: "succeeded", amount_cents: 657_000 }], today),
    657_000
  );
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

test("an invoice's chip says what's still due, then that it's paid", () => {
  assert.deepEqual(invoiceMoneyChip({ totalCents: 44_750, paidCents: 0 }), {
    label: "$447.50 due",
    tone: "amber",
  });
  assert.deepEqual(invoiceMoneyChip({ totalCents: 44_750, paidCents: 40_000 }), {
    label: "$47.50 due",
    tone: "amber",
  });
  assert.deepEqual(invoiceMoneyChip({ totalCents: 44_750, paidCents: 44_750 }), {
    label: "Paid",
    tone: "green",
  });
});

// Clicking Pay records a pending row before Stripe's page even opens. A
// customer who backed out (or whose card was refused) left that row
// behind, the phase read "Clearing -- nothing more to do", and the Pay
// button was gone until Stripe expired the session a day later.
test("a checkout opened and abandoned still leaves the phase owed", () => {
  assert.equal(
    billedPhaseDueCents(
      [billed],
      [{ estimate_payment_id: "p1", status: "pending", amount_cents: 657_000, stripe_session_id: "cs_1", stripe_payment_intent_id: null }],
      today
    ),
    657_000
  );
});

test("a bank transfer that went through checkout is clearing, not owed", () => {
  assert.equal(
    billedPhaseDueCents(
      [billed],
      [{ estimate_payment_id: "p1", status: "pending", amount_cents: 657_000, stripe_session_id: "cs_1", stripe_payment_intent_id: "pi_1" }],
      today
    ),
    0
  );
});
