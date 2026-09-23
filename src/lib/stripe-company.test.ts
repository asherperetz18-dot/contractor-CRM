import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * STRIPE_SECRET_KEY is the AI Build Pros account: it sells the CRM to new
 * companies. A contractor's customer paying a deposit must go into that
 * contractor's own Stripe, never into ours -- so nothing on the deposit
 * path may read the deployment key. A company with no account of its own
 * simply has no online Pay button.
 */

const DEPOSIT_PATH = [
  "stripe-company.ts",
  "actions/portal-payments.ts",
  "../app/api/stripe/webhook/[companyId]/route.ts",
];

test("customer deposits never fall back to the AI Build Pros Stripe key", () => {
  for (const file of DEPOSIT_PATH) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /getStripeEnv/, `${file} reads the platform Stripe key`);
    assert.doesNotMatch(source, /process\.env\.STRIPE_/, `${file} reads the platform Stripe key`);
  }
});
