"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalViewer, portalBaseUrl } from "@/lib/portal/session";
import { getStripeEnv, stripeClient } from "@/lib/stripe-env";
import {
  depositCents,
  phaseState,
  type EstimatePayment,
  type EstimateStatus,
  type PhaseState,
  type PortalPayment,
} from "@/lib/data/types";

type PayableEstimate = {
  id: string;
  lead_id: string;
  company_id: string;
  doc_number: string;
  title: string;
  status: EstimateStatus;
  total_cents: number;
  deposit_cents: number | null;
  deposit_percent_bp: number;
  deposit_cap_cents: number;
};

export type DepositState = {
  payable: boolean;
  amountCents: number;
  paid: boolean;
  paidAt: string | null;
  configured: boolean;
  reason?: string;
};

/**
 * What the portal should show for the deposit.
 *
 * The amount is always re-derived here from the estimate's own total and
 * its snapshotted deposit policy -- never read from the page and never
 * accepted from the browser. A payment amount that can be influenced by
 * the client is a payment amount that will be.
 */
export async function getDepositState(estimateId: string): Promise<DepositState> {
  const none: DepositState = {
    payable: false,
    amountCents: 0,
    paid: false,
    paidAt: null,
    configured: !!getStripeEnv(),
  };

  const viewer = await getPortalViewer();
  if (!viewer) return { ...none, reason: "Your sign-in link has expired." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("estimates")
    .select(
      "id, lead_id, company_id, doc_number, title, status, total_cents, deposit_cents, deposit_percent_bp, deposit_cap_cents"
    )
    .eq("id", estimateId)
    .maybeSingle<PayableEstimate>();
  if (!data || data.lead_id !== viewer.lead.id) return none;

  const { data: paid } = await admin
    .from("portal_payments")
    .select("id, paid_at")
    .eq("estimate_id", estimateId)
    .eq("kind", "deposit")
    .eq("status", "succeeded")
    .maybeSingle<{ id: string; paid_at: string | null }>();
  if (paid) return { ...none, paid: true, paidAt: paid.paid_at };

  // A deposit is due on signing, so there is nothing to collect before
  // the customer has actually committed.
  if (data.status !== "Signed") {
    return { ...none, reason: "The deposit is due once the estimate is signed." };
  }

  const amountCents = depositCents(
    data.total_cents,
    data.deposit_percent_bp,
    data.deposit_cap_cents
  );
  if (amountCents <= 0) return none;

  return {
    payable: !!getStripeEnv(),
    amountCents,
    paid: false,
    paidAt: null,
    configured: !!getStripeEnv(),
  };
}

export type PortalPhase = {
  id: string;
  name: string;
  description: string | null;
  amountCents: number;
  dueDate: string | null;
  state: PhaseState;
  paidAt: string | null;
};

/**
 * The progress payments this customer can see.
 *
 * Only phases the contractor has actually billed appear. An unbilled
 * phase is work not yet done -- showing a Pay button for it would invite
 * paying for something nobody has built, and would bury the one payment
 * that is genuinely due under three that are not.
 *
 * Paid phases stay visible, because a customer looking for proof they
 * already paid needs to find it here.
 */
export async function getPortalPhases(estimateId: string): Promise<PortalPhase[]> {
  const viewer = await getPortalViewer();
  if (!viewer) return [];

  const admin = createAdminClient();
  const { data: estimate } = await admin
    .from("estimates")
    .select("id, lead_id, status")
    .eq("id", estimateId)
    .maybeSingle<{ id: string; lead_id: string; status: EstimateStatus }>();
  if (!estimate || estimate.lead_id !== viewer.lead.id) return [];
  if (estimate.status !== "Signed") return [];

  const [{ data: phases }, { data: payments }] = await Promise.all([
    admin
      .from("estimate_payments")
      .select("id, estimate_id, sort_order, name, description, amount_cents, requested_at, due_date")
      .eq("estimate_id", estimateId)
      .order("sort_order")
      .returns<EstimatePayment[]>(),
    admin
      .from("portal_payments")
      .select("id, estimate_payment_id, status, paid_at")
      .eq("estimate_id", estimateId)
      .returns<Pick<PortalPayment, "id" | "estimate_payment_id" | "status" | "paid_at">[]>(),
  ]);

  return (phases ?? [])
    .filter((p) => p.requested_at && p.amount_cents > 0)
    .map((p) => {
      const on = (payments ?? []).filter((x) => x.estimate_payment_id === p.id);
      const settled = on.find((x) => x.status === "succeeded");
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        amountCents: p.amount_cents,
        dueDate: p.due_date ?? null,
        state: phaseState(p, on),
        paidAt: settled?.paid_at ?? null,
      };
    });
}

/**
 * Starts a Stripe Checkout session for one billed progress phase.
 *
 * Same rule as the deposit: the amount is read from the phase row on the
 * server, never from the request. The only thing the browser supplies is
 * which phase, and that is checked against this viewer's own contract.
 */
export async function startPhaseCheckout(
  phaseId: string
): Promise<{ error?: string; url?: string }> {
  const viewer = await getPortalViewer();
  if (!viewer) return { error: "Your sign-in link has expired. Request a new one." };

  const env = getStripeEnv();
  if (!env) return { error: "Online payment isn't switched on yet." };

  const admin = createAdminClient();
  const { data: phase } = await admin
    .from("estimate_payments")
    .select("id, estimate_id, company_id, name, amount_cents, requested_at, due_date")
    .eq("id", phaseId)
    .maybeSingle<{
      id: string;
      estimate_id: string;
      company_id: string;
      name: string;
      amount_cents: number;
      requested_at: string | null;
      due_date: string | null;
    }>();
  if (!phase) return { error: "That payment isn't available." };
  // Unbilled means the contractor has not asked for it yet.
  if (!phase.requested_at) return { error: "That payment isn't due yet." };
  if (phase.amount_cents <= 0) return { error: "There's nothing to pay on this phase." };

  const { data: estimate } = await admin
    .from("estimates")
    .select("id, lead_id, company_id, doc_number, title, status")
    .eq("id", phase.estimate_id)
    .maybeSingle<PayableEstimate>();
  if (!estimate || estimate.lead_id !== viewer.lead.id) {
    return { error: "That payment isn't available." };
  }
  if (estimate.status !== "Signed") return { error: "This contract isn't signed." };

  const { data: already } = await admin
    .from("portal_payments")
    .select("id")
    .eq("estimate_payment_id", phaseId)
    .eq("status", "succeeded")
    .maybeSingle();
  if (already) return { error: "This payment has already been made." };

  const { data: company } = await admin
    .from("company_profile")
    .select("name")
    .eq("company_id", estimate.company_id)
    .maybeSingle<{ name: string | null }>();

  const base = portalBaseUrl();
  try {
    const stripe = stripeClient(env);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: phase.amount_cents,
            product_data: {
              name: `${phase.name || "Progress payment"} — ${estimate.doc_number}`,
              description: `${estimate.title || "Project"} with ${company?.name ?? "your contractor"}`,
            },
          },
        },
      ],
      metadata: {
        estimate_id: estimate.id,
        estimate_payment_id: phase.id,
        lead_id: estimate.lead_id,
        company_id: estimate.company_id,
        kind: "progress",
      },
      success_url: `${base}/portal/estimates/${estimate.id}?paid=1`,
      cancel_url: `${base}/portal/estimates/${estimate.id}`,
    });

    if (!session.url) return { error: "Couldn't start the payment. Try again." };

    await admin.from("portal_payments").insert({
      company_id: estimate.company_id,
      estimate_id: estimate.id,
      estimate_payment_id: phase.id,
      lead_id: estimate.lead_id,
      kind: "progress",
      amount_cents: phase.amount_cents,
      status: "pending",
      stripe_session_id: session.id,
    });

    return { url: session.url };
  } catch {
    return { error: "Couldn't reach the payment provider. Try again in a moment." };
  }
}

/**
 * Starts a Stripe Checkout session for the deposit.
 *
 * Card and ACH are both offered: on construction sums the fee gap is
 * large enough to matter (0.8% capped at $5 against 2.9% + 30c), so the
 * customer gets to choose and the contractor keeps the difference on
 * anything sizeable.
 */
export async function startDepositCheckout(
  estimateId: string
): Promise<{ error?: string; url?: string }> {
  const viewer = await getPortalViewer();
  if (!viewer) return { error: "Your sign-in link has expired. Request a new one." };

  const env = getStripeEnv();
  if (!env) return { error: "Online payment isn't switched on yet." };

  const admin = createAdminClient();
  const { data: estimate } = await admin
    .from("estimates")
    .select(
      "id, lead_id, company_id, doc_number, title, status, total_cents, deposit_cents, deposit_percent_bp, deposit_cap_cents"
    )
    .eq("id", estimateId)
    .maybeSingle<PayableEstimate>();
  if (!estimate || estimate.lead_id !== viewer.lead.id) {
    return { error: "That estimate isn't available." };
  }
  if (estimate.status !== "Signed") {
    return { error: "The deposit is due once the estimate is signed." };
  }

  const { data: already } = await admin
    .from("portal_payments")
    .select("id")
    .eq("estimate_id", estimateId)
    .eq("kind", "deposit")
    .eq("status", "succeeded")
    .maybeSingle();
  if (already) return { error: "This deposit has already been paid." };

  // Recomputed from the document, not taken from the request. The same
  // rule that caps a written deposit at $1,000 caps what can be collected
  // online, so a link cannot charge more than the contract allows.
  const amountCents = depositCents(
    estimate.total_cents,
    estimate.deposit_percent_bp,
    estimate.deposit_cap_cents
  );
  if (amountCents <= 0) return { error: "There's no deposit due on this estimate." };

  const { data: company } = await admin
    .from("company_profile")
    .select("name")
    .eq("company_id", estimate.company_id)
    .maybeSingle<{ name: string | null }>();

  const base = portalBaseUrl();
  try {
    const stripe = stripeClient(env);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // Deliberately NOT pinned to ["card", "us_bank_account"]. Naming a
      // method the Stripe account has not enabled makes session creation
      // fail outright -- so before ACH is switched on, asking for it would
      // break card payments too, which is the opposite of degrading well.
      // Left to the account's own payment-method settings instead: cards
      // work immediately, and ACH appears the moment it is enabled without
      // needing a deploy.
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: `Deposit — ${estimate.doc_number}`,
              description: `${estimate.title || "Project"} with ${company?.name ?? "your contractor"}`,
            },
          },
        },
      ],
      // Carried through so the webhook can match the payment back without
      // trusting anything the browser returns with.
      metadata: {
        estimate_id: estimate.id,
        lead_id: estimate.lead_id,
        company_id: estimate.company_id,
        kind: "deposit",
      },
      success_url: `${base}/portal/estimates/${estimate.id}?paid=1`,
      cancel_url: `${base}/portal/estimates/${estimate.id}`,
    });

    if (!session.url) return { error: "Couldn't start the payment. Try again." };

    // Recorded as pending before the customer leaves, so an abandoned
    // checkout is still visible rather than being invisible until it
    // succeeds.
    await admin.from("portal_payments").insert({
      company_id: estimate.company_id,
      estimate_id: estimate.id,
      lead_id: estimate.lead_id,
      kind: "deposit",
      amount_cents: amountCents,
      status: "pending",
      stripe_session_id: session.id,
    });

    return { url: session.url };
  } catch {
    return { error: "Couldn't reach the payment provider. Try again in a moment." };
  }
}
