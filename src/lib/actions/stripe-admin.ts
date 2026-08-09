"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { getStripeEnv, stripeClient } from "@/lib/stripe-env";

export type EndpointInfo = {
  url: string;
  status: string;
  events: string[];
  missingEvents: string[];
};

export type PendingInfo = {
  docNumber: string;
  amountCents: number;
  createdAt: string;
  sessionStatus: string;
  paymentStatus: string;
  methodTypes: string[];
  verdict: string;
};

export type StripeDiagnostics = {
  configured: boolean;
  keyMode: "test" | "live" | null;
  webhookSecretSet: boolean;
  endpoints: EndpointInfo[];
  achEnabled: boolean | null;
  pending: PendingInfo[];
  error?: string;
};

// The events this app actually acts on. Anything missing here means a
// payment can complete at Stripe and never be recorded.
const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
];

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  return profile;
}

/**
 * Reads back what Stripe itself is configured to do.
 *
 * Written because a payment that never arrives is indistinguishable, from
 * inside this app, between "the customer abandoned checkout" and "the
 * webhook never reached us" -- both leave a pending row and nothing else.
 * The secret key lives only in the deployment environment, so this is the
 * only place that can ask.
 */
export async function stripeDiagnostics(): Promise<StripeDiagnostics> {
  const profile = await requireAdmin();
  const empty: StripeDiagnostics = {
    configured: false,
    keyMode: null,
    webhookSecretSet: false,
    endpoints: [],
    achEnabled: null,
    pending: [],
  };
  if (!profile) return { ...empty, error: "Admins only." };

  const env = getStripeEnv();
  if (!env) return { ...empty, error: "Stripe isn't connected — STRIPE_SECRET_KEY is not set." };

  const keyMode = env.secretKey.startsWith("sk_live") ? "live" : "test";
  const stripe = stripeClient(env);

  let endpoints: EndpointInfo[] = [];
  let achEnabled: boolean | null = null;
  try {
    const eps = await stripe.webhookEndpoints.list({ limit: 10 });
    endpoints = eps.data.map((e) => ({
      url: e.url,
      status: e.status,
      events: e.enabled_events,
      missingEvents: e.enabled_events.includes("*")
        ? []
        : REQUIRED_EVENTS.filter((r) => !e.enabled_events.includes(r)),
    }));

    // Dynamic payment methods decide what shows at checkout, so ACH being
    // "on" is a property of the account's configuration, not of our code.
    const configs = await stripe.paymentMethodConfigurations.list();
    const active = configs.data.find((c) => c.is_default) ?? configs.data[0];
    achEnabled = active?.us_bank_account?.display_preference?.value === "on";
  } catch (e) {
    return {
      ...empty,
      configured: true,
      keyMode,
      webhookSecretSet: !!env.webhookSecret,
      error: e instanceof Error ? e.message : "Could not reach Stripe.",
    };
  }

  // Ask Stripe what really happened to every payment stuck pending here.
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("portal_payments")
    .select("id, amount_cents, created_at, stripe_session_id, estimates(doc_number)")
    .eq("company_id", profile.company_id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<
      {
        id: string;
        amount_cents: number;
        created_at: string;
        stripe_session_id: string | null;
        estimates: { doc_number: string } | null;
      }[]
    >();

  const pending: PendingInfo[] = [];
  for (const r of rows ?? []) {
    if (!r.stripe_session_id) continue;
    try {
      const s = await stripe.checkout.sessions.retrieve(r.stripe_session_id);
      pending.push({
        docNumber: r.estimates?.doc_number ?? "—",
        amountCents: r.amount_cents,
        createdAt: r.created_at,
        sessionStatus: s.status ?? "unknown",
        paymentStatus: s.payment_status ?? "unknown",
        methodTypes: s.payment_method_types ?? [],
        verdict:
          s.payment_status === "paid"
            ? "Paid at Stripe but not recorded here — the webhook did not arrive. Sync will fix it."
            : s.status === "expired"
              ? "Checkout expired without payment."
              : s.status === "open"
                ? "Checkout was opened and never completed."
                : "Completed at Stripe but not yet paid (ACH still clearing).",
      });
    } catch {
      pending.push({
        docNumber: r.estimates?.doc_number ?? "—",
        amountCents: r.amount_cents,
        createdAt: r.created_at,
        sessionStatus: "not found",
        paymentStatus: "unknown",
        methodTypes: [],
        verdict: "Stripe has no such session — it may belong to a different Stripe account or key.",
      });
    }
  }

  return {
    configured: true,
    keyMode,
    webhookSecretSet: !!env.webhookSecret,
    endpoints,
    achEnabled,
    pending,
  };
}

/**
 * Brings pending payments back in line with Stripe.
 *
 * The webhook is the fast path, not the only path. Relying on it alone
 * means one missed delivery loses a payment permanently, which is not an
 * acceptable failure mode for money. This asks Stripe directly and is
 * safe to run repeatedly -- it only ever moves a row to what Stripe
 * already says is true.
 */
export async function reconcilePendingPayments(): Promise<{
  error?: string;
  updated?: number;
  checked?: number;
  notes?: string[];
}> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };

  const env = getStripeEnv();
  if (!env) return { error: "Stripe isn't connected." };
  const stripe = stripeClient(env);
  const admin = createAdminClient();

  const { data: rows } = await admin
    .from("portal_payments")
    .select("id, amount_cents, stripe_session_id, estimates(doc_number)")
    .eq("company_id", profile.company_id)
    .eq("status", "pending")
    .returns<
      {
        id: string;
        amount_cents: number;
        stripe_session_id: string | null;
        estimates: { doc_number: string } | null;
      }[]
    >();

  const notes: string[] = [];
  let updated = 0;
  for (const r of rows ?? []) {
    if (!r.stripe_session_id) continue;
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(r.stripe_session_id);
    } catch {
      notes.push(`${r.estimates?.doc_number ?? "—"}: session not found at Stripe, left alone.`);
      continue;
    }

    const doc = r.estimates?.doc_number ?? "—";
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (session.payment_status === "paid") {
      patch.status = "succeeded";
      patch.paid_at = new Date().toISOString();
      patch.method = session.payment_method_types?.[0] ?? null;
      patch.stripe_payment_intent_id =
        typeof session.payment_intent === "string" ? session.payment_intent : null;
      notes.push(`${doc}: marked paid.`);
    } else if (session.status === "expired") {
      patch.status = "cancelled";
      notes.push(`${doc}: checkout expired, marked cancelled.`);
    } else {
      // Still legitimately in flight -- an ACH debit takes 4-5 business
      // days. Record the method so the CRM can say "bank transfer
      // clearing" rather than showing nothing, but leave the status
      // alone: this is not a state change, so it is not counted as one.
      if (session.payment_method_types?.[0]) patch.method = session.payment_method_types[0];
      await admin.from("portal_payments").update(patch).eq("id", r.id);
      notes.push(`${doc}: still ${session.status}/${session.payment_status}, left pending.`);
      continue;
    }

    // Row count checked rather than trusting a missing error: a blocked
    // update matches zero rows and raises nothing.
    const { data } = await admin.from("portal_payments").update(patch).eq("id", r.id).select("id");
    if (data?.length) updated += 1;
  }

  revalidatePath("/payments");
  revalidatePath("/settings/portal-payments");
  return { updated, checked: rows?.length ?? 0, notes };
}
