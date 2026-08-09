"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { stripeClient } from "@/lib/stripe-env";
import { getStripeForCompany } from "@/lib/stripe-company";
import { encryptionAvailable, encryptSecret, secretTail } from "@/lib/crypto/secrets";
import { portalBaseUrl } from "@/lib/portal/session";
import { resolvePaymentMethod } from "@/lib/stripe-method";

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

export type PmConfigInfo = {
  id: string;
  name: string;
  isDefault: boolean;
  ach: string;
  card: string;
};

export type StripeDiagnostics = {
  configured: boolean;
  keyMode: "test" | "live" | null;
  webhookSecretSet: boolean;
  /** Whether this company uses its own Stripe account or the platform fallback. */
  source: "company" | "platform" | null;
  /** The URL this company must give Stripe, which is unique to it. */
  webhookUrl: string;
  /** Whether APP_ENCRYPTION_KEY is readable by the running deployment. */
  encryptionReady: boolean;
  endpoints: EndpointInfo[];
  achEnabled: boolean | null;
  /** Every payment-method configuration, because the one the dashboard
      happens to be showing is not necessarily the one checkout uses. */
  configs: PmConfigInfo[];
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
    source: null,
    webhookUrl: "",
    encryptionReady: encryptionAvailable(),
    endpoints: [],
    achEnabled: null,
    configs: [],
    pending: [],
  };
  if (!profile) return { ...empty, error: "Admins only." };

  // Unique to this company, because each contractor's Stripe signs with
  // its own secret and the company must be known before the payload can
  // be trusted.
  empty.webhookUrl = `${portalBaseUrl()}/api/stripe/webhook/${profile.company_id}`;

  const env = await getStripeForCompany(profile.company_id);
  if (!env)
    return {
      ...empty,
      error: "No Stripe account is connected for this company yet.",
    };

  const keyMode = env.secretKey.startsWith("sk_live") ? "live" : "test";
  const stripe = stripeClient(env);

  let endpoints: EndpointInfo[] = [];
  let achEnabled: boolean | null = null;
  let pmConfigs: PmConfigInfo[] = [];
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
    //
    // Listed in full rather than reduced to one boolean: an account can
    // hold several configurations, the Dashboard deep-links to whichever
    // one you last opened, and Checkout uses the DEFAULT unless a session
    // names another. Enabling ACH on a non-default configuration looks
    // exactly like enabling it, and changes nothing at checkout.
    const list = await stripe.paymentMethodConfigurations.list();
    pmConfigs = list.data.map((c) => ({
      id: c.id,
      name: c.name ?? "(unnamed)",
      isDefault: !!c.is_default,
      ach: c.us_bank_account?.display_preference?.value ?? "not available",
      card: c.card?.display_preference?.value ?? "not available",
    }));
    const active = list.data.find((c) => c.is_default) ?? list.data[0];
    achEnabled = active?.us_bank_account?.display_preference?.value === "on";
  } catch (e) {
    return {
      ...empty,
      configured: true,
      keyMode,
      webhookSecretSet: !!env.webhookSecret,
      source: env.source,
      configs: pmConfigs,
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
    ...empty,
    configured: true,
    keyMode,
    webhookSecretSet: !!env.webhookSecret,
    source: env.source,
    endpoints,
    achEnabled,
    configs: pmConfigs,
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

  const env = await getStripeForCompany(profile.company_id);
  if (!env) return { error: "No Stripe account is connected for this company yet." };
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
      patch.method = await resolvePaymentMethod(stripe, session);
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
      const inFlightMethod = await resolvePaymentMethod(stripe, session);
      if (inFlightMethod) patch.method = inFlightMethod;
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

/**
 * Stores this company's own Stripe credentials.
 *
 * Write-only by design: the key is sealed immediately and only its last
 * four characters are kept in the clear, so nothing can ever hand a
 * customer's live secret back to a browser -- not this form, not a
 * misplaced console.log, not a compromised admin session.
 *
 * Refuses outright when no platform encryption key is configured.
 * Storing a live Stripe secret in plaintext because a setting was
 * missing is worse than the feature not working.
 */
export async function saveCompanyStripeKeys(input: {
  secretKey: string;
  webhookSecret: string;
}): Promise<{ error?: string; ok?: boolean; mode?: "test" | "live" }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };

  if (!encryptionAvailable()) {
    return {
      error:
        "Credential encryption isn't configured on the server (APP_ENCRYPTION_KEY), so keys cannot be stored safely.",
    };
  }

  const secretKey = input.secretKey.trim();
  const webhookSecret = input.webhookSecret.trim();

  // Caught here rather than at the first failed payment: a publishable
  // key in this box would look saved and then break checkout for real
  // customers.
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secretKey)) {
    return {
      error: secretKey.startsWith("pk_")
        ? "That's a publishable key. The secret key starts with sk_."
        : "That doesn't look like a Stripe secret key (it should start with sk_ or rk_).",
    };
  }
  if (webhookSecret && !webhookSecret.startsWith("whsec_")) {
    return { error: "The signing secret should start with whsec_." };
  }

  const mode: "test" | "live" = secretKey.includes("_live_") ? "live" : "test";
  const secretEnc = encryptSecret(secretKey);
  const webhookEnc = webhookSecret ? encryptSecret(webhookSecret) : null;
  if (!secretEnc) return { error: "Could not encrypt the key. Nothing was saved." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("company_profile")
    .update({
      stripe_secret_key_enc: secretEnc,
      stripe_webhook_secret_enc: webhookEnc,
      stripe_key_last4: secretTail(secretKey),
      stripe_key_mode: mode,
      stripe_connected_at: new Date().toISOString(),
    })
    .eq("company_id", profile.company_id)
    .select("company_id");
  // Row count rather than the absence of an error: a blocked update
  // matches zero rows and raises nothing.
  if (error || !data?.length) return { error: error?.message || "Could not save the keys." };

  revalidatePath("/settings/portal-payments");
  return { ok: true, mode };
}

/** Disconnects this company's account, falling back to the platform's. */
export async function clearCompanyStripeKeys(): Promise<{ error?: string; ok?: boolean }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("company_profile")
    .update({
      stripe_secret_key_enc: null,
      stripe_webhook_secret_enc: null,
      stripe_key_last4: null,
      stripe_key_mode: null,
      stripe_connected_at: null,
    })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error || !data?.length) return { error: error?.message || "Could not disconnect." };

  revalidatePath("/settings/portal-payments");
  return { ok: true };
}

export type CompanyStripeStatus = {
  connected: boolean;
  last4: string | null;
  mode: "test" | "live" | null;
  connectedAt: string | null;
  encryptionReady: boolean;
  webhookUrl: string;
};

/** What the Settings screen shows about this company's connection. */
export async function getCompanyStripeStatus(): Promise<CompanyStripeStatus | null> {
  const profile = await requireAdmin();
  if (!profile) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("stripe_secret_key_enc, stripe_key_last4, stripe_key_mode, stripe_connected_at")
    .eq("company_id", profile.company_id)
    .maybeSingle<{
      stripe_secret_key_enc: string | null;
      stripe_key_last4: string | null;
      stripe_key_mode: "test" | "live" | null;
      stripe_connected_at: string | null;
    }>();

  return {
    connected: !!data?.stripe_secret_key_enc,
    last4: data?.stripe_key_last4 ?? null,
    mode: data?.stripe_key_mode ?? null,
    connectedAt: data?.stripe_connected_at ?? null,
    encryptionReady: encryptionAvailable(),
    webhookUrl: `${portalBaseUrl()}/api/stripe/webhook/${profile.company_id}`,
  };
}
