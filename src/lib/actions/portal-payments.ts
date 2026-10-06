"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalViewer, portalBaseUrl } from "@/lib/portal/session";
import { stripeClient } from "@/lib/stripe-env";
import { getStripeForCompany } from "@/lib/stripe-company";
import { leftoverCheckoutAction } from "@/lib/stripe/checkout-reuse";
import {
  MIN_ONLINE_CHARGE_CENTS,
  depositCents,
  depositPayment,
  isUnfinishedCheckout,
  moneyCents,
  phaseCheckoutCents,
  phaseOwedCents,
  phaseState,
  type EstimatePayment,
  type EstimateStatus,
  type PhaseState,
  type PortalPayment,
} from "@/lib/data/types";
import { loadCompanyWords } from "@/lib/load-company-words";
import { word } from "@/lib/company-words";

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
  /** This client is billed outside the CRM (e.g. QuickBooks): show the
   *  one "invoiced separately" line instead of any pay button. */
  invoicedSeparately?: boolean;
  reason?: string;
};

/**
 * The per-client switch (client card > Online payments, migration 0133).
 * Read off the viewer's own lead row -- getPortalViewer selects the
 * whole row, so on a database where the column doesn't exist yet this
 * reads undefined, and undefined means payments stay ON.
 */
/**
 * The line under the amount on the card payment page, in the company's
 * own words (DECISIONS #121): "Kitchen Remodel with Summit Builders Co",
 * or "Job with ..." for an untitled document of a company that says Job.
 */
async function checkoutDescription(
  admin: ReturnType<typeof createAdminClient>,
  estimate: { company_id: string; title: string | null },
  companyName: string | null | undefined
): Promise<string> {
  const what = estimate.title || word(await loadCompanyWords(admin, estimate.company_id), "project");
  return companyName ? `${what} with ${companyName}` : what;
}

function paysOutsidePortal(lead: { portal_payments_disabled?: boolean }): boolean {
  return lead.portal_payments_disabled === true;
}

const INVOICED_SEPARATELY_ERROR =
  "Payments are invoiced separately — please use the invoice you were sent.";

/**
 * What the portal should show for the deposit.
 *
 * The amount is always re-derived here from the estimate's own total and
 * its snapshotted deposit policy -- never read from the page and never
 * accepted from the browser. A payment amount that can be influenced by
 * the client is a payment amount that will be.
 */
export async function getDepositState(estimateId: string): Promise<DepositState> {
  // Whether payment is switched on is now a property of the company, not
  // of the deployment, and the company is not known until the estimate
  // loads -- so the early exits below claim nothing either way.
  const none: DepositState = {
    payable: false,
    amountCents: 0,
    paid: false,
    paidAt: null,
    configured: false,
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

  // Paid while any of it is kept: a deposit refunded in full is due
  // again (DECISIONS #155). Every row, so a refund never reads as one.
  const { data: depositRows } = await admin
    .from("portal_payments")
    .select("kind, status, amount_cents, paid_at, method")
    .eq("estimate_id", estimateId)
    .eq("kind", "deposit")
    .eq("status", "succeeded")
    .returns<Pick<PortalPayment, "kind" | "status" | "amount_cents" | "paid_at" | "method">[]>();
  const paid = depositPayment(depositRows ?? []);
  if (paid) return { ...none, paid: true, paidAt: paid.paid_at };

  // After the paid check on purpose: a deposit that DID settle through
  // the portal stays visible as paid even once the client is switched
  // to outside invoicing.
  if (paysOutsidePortal(viewer.lead)) {
    return { ...none, invoicedSeparately: true };
  }

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

  // Payable only if the company that owns this estimate has an account
  // to take the money into.
  const stripe = await getStripeForCompany(data.company_id);
  return {
    payable: !!stripe,
    amountCents,
    paid: false,
    paidAt: null,
    configured: !!stripe,
  };
}

export type PortalPhase = {
  id: string;
  name: string;
  description: string | null;
  amountCents: number;
  /** What is still owed on the phase. Less than amountCents once a
   *  partial payment has been recorded against it. */
  owedCents: number;
  /** What the Pay button charges: what is owed less money already on its
   *  way. The rest of a part-paid phase, never the face amount again. */
  payableCents: number;
  dueDate: string | null;
  state: PhaseState;
  paidAt: string | null;
  /** Credited off it by the contractor (DECISIONS #154). */
  creditCents: number;
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
      .select("*")
      .eq("estimate_id", estimateId)
      .order("sort_order")
      .returns<EstimatePayment[]>(),
    admin
      .from("portal_payments")
      .select("id, estimate_payment_id, status, amount_cents, paid_at, stripe_session_id, stripe_payment_intent_id")
      .eq("estimate_id", estimateId)
      .returns<
        Pick<
          PortalPayment,
          | "id"
          | "estimate_payment_id"
          | "status"
          | "amount_cents"
          | "paid_at"
          | "stripe_session_id"
          | "stripe_payment_intent_id"
        >[]
      >(),
  ]);

  return (phases ?? [])
    .filter((p) => p.requested_at && p.amount_cents > 0)
    .map((p) => {
      // A checkout opened and abandoned is not money on its way: counting
      // it read "Clearing" and hid the Pay button for a day.
      const on = (payments ?? []).filter(
        (x) => x.estimate_payment_id === p.id && !isUnfinishedCheckout(x)
      );
      // When money came in -- a refund (#155) is a row too, never this.
      const settled = on.find((x) => x.status === "succeeded" && x.amount_cents > 0);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        amountCents: p.amount_cents,
        owedCents: phaseOwedCents(p, on),
        payableCents: phaseCheckoutCents(p, on),
        dueDate: p.due_date ?? null,
        state: phaseState(p, on),
        paidAt: settled?.paid_at ?? null,
        creditCents: Math.max(0, p.credit_cents ?? 0),
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

  const admin = createAdminClient();
  const { data: phase } = await admin
    .from("estimate_payments")
    .select("*")
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
  // The server refuses, not just the page: a tab opened before the
  // client was switched to outside invoicing still holds a Pay button.
  if (paysOutsidePortal(viewer.lead)) return { error: INVOICED_SEPARATELY_ERROR };
  // Unbilled means the contractor has not asked for it yet.
  if (!phase.requested_at) return { error: "That payment isn't due yet." };
  if (phase.amount_cents <= 0) return { error: "There's nothing to pay on this phase." };

  // Resolved from the phase's own company, so the money lands in the
  // account belonging to the business doing the work.
  const env = await getStripeForCompany(phase.company_id);
  if (!env) return { error: "Online payment isn't switched on yet." };

  const { data: estimate } = await admin
    .from("estimates")
    .select("id, lead_id, company_id, doc_number, title, status")
    .eq("id", phase.estimate_id)
    .maybeSingle<PayableEstimate>();
  if (!estimate || estimate.lead_id !== viewer.lead.id) {
    return { error: "That payment isn't available." };
  }
  if (estimate.status !== "Signed") return { error: "This contract isn't signed." };

  // What is left to pay, not the face amount: a phase part-paid by
  // cheque is charged only the rest, and money already on its way is
  // never charged twice. The same figure goes to Stripe and onto the
  // pending row the webhook settles, so the two can't disagree.
  const { data: rows } = await admin
    .from("portal_payments")
    .select("id, status, amount_cents, stripe_session_id, stripe_payment_intent_id")
    .eq("estimate_payment_id", phaseId)
    .returns<
      Pick<PortalPayment, "id" | "status" | "amount_cents" | "stripe_session_id" | "stripe_payment_intent_id">[]
    >();
  const payments = rows ?? [];
  const cents = phaseCheckoutCents(phase, payments);
  if (cents === 0) {
    return payments.some((p) => p.status === "pending" && !isUnfinishedCheckout(p))
      ? { error: "This payment is already going through. Refresh the page in a minute." }
      : { error: "This payment has already been made." };
  }

  const { data: company } = await admin
    .from("company_profile")
    .select("name")
    .eq("company_id", estimate.company_id)
    .maybeSingle<{ name: string | null }>();

  if (cents < MIN_ONLINE_CHARGE_CENTS) {
    return {
      error: `The remaining ${moneyCents(cents)} can't be paid online. ${company?.name || "Your contractor"} will settle it with you.`,
    };
  }

  const base = portalBaseUrl();
  try {
    const stripe = stripeClient(env);

    // A checkout this customer opened earlier and left. Handing back the
    // one still open, instead of starting another, is what stops two
    // tabs from paying the same phase twice.
    for (const row of payments.filter(isUnfinishedCheckout)) {
      // A session Stripe can't find (the company changed accounts) is no
      // reason to refuse the customer a fresh one.
      const prior = await stripe.checkout.sessions
        .retrieve(row.stripe_session_id!)
        .catch(() => null);
      if (!prior) continue;
      // An open checkout for the full amount is closed once part has been
      // paid another way: it would charge the old figure.
      const action = leftoverCheckoutAction(prior, cents);
      if (action === "reuse" && prior.url) return { url: prior.url };
      if (action === "in-flight") {
        return { error: "This payment is already going through. Refresh the page in a minute." };
      }
      if (action === "expire") await stripe.checkout.sessions.expire(prior.id);
      await admin
        .from("portal_payments")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", row.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: cents,
            product_data: {
              name: `${phase.name || "Progress payment"}${cents < phase.amount_cents ? " (remaining balance)" : ""} — ${estimate.doc_number}`,
              description: await checkoutDescription(admin, estimate, company?.name),
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
      amount_cents: cents,
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
  // Same server-side refusal as the phase checkout -- see there.
  if (paysOutsidePortal(viewer.lead)) return { error: INVOICED_SEPARATELY_ERROR };
  if (estimate.status !== "Signed") {
    return { error: "The deposit is due once the estimate is signed." };
  }

  // The contractor's own Stripe account, not the platform's -- a
  // customer of one business must never pay into another's.
  const env = await getStripeForCompany(estimate.company_id);
  if (!env) return { error: "Online payment isn't switched on yet." };

  // Kept money, not "a paid row": a refund is a row too (#155).
  const { data: depositRows } = await admin
    .from("portal_payments")
    .select("kind, status, amount_cents, paid_at, method")
    .eq("estimate_id", estimateId)
    .eq("kind", "deposit")
    .eq("status", "succeeded")
    .returns<Pick<PortalPayment, "kind" | "status" | "amount_cents" | "paid_at" | "method">[]>();
  if (depositPayment(depositRows ?? [])) return { error: "This deposit has already been paid." };

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
              name: `${word(await loadCompanyWords(admin, estimate.company_id), "deposit")} — ${estimate.doc_number}`,
              description: await checkoutDescription(admin, estimate, company?.name),
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
