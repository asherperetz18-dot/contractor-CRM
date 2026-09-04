import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeEnv, stripeClient } from "@/lib/stripe-env";
import { sendEmail, escapeHtml } from "@/lib/email-env";
import {
  DEFAULT_CALENDARS,
  DEFAULT_CALL_DISPOSITIONS,
  DEFAULT_LEAD_SOURCES,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PROJECT_TYPES,
} from "@/lib/data/company-defaults";
import { createInvite, markInviteSent, registerUrl } from "@/lib/signup/invites";

// The Stripe price the public signup page sells. Left in an env var so
// the plan can be changed, or a second one introduced, without a deploy
// -- and so a deployment that has not set it simply has no public signup
// rather than a broken one.
export function signupPriceId(): string | null {
  const value = process.env.SIGNUP_PRICE_ID?.trim();
  return value ? value : null;
}

export function signupConfigured(): boolean {
  return Boolean(getStripeEnv() && signupPriceId());
}

/**
 * `companies.name` is unique across the whole system, which was fine when
 * only an admin could add one and could see the clash coming. A stranger
 * paying on the public page cannot, and two real businesses are allowed
 * to share a name -- so the second one gets a suffix rather than a failed
 * signup after their card was charged. They can rename it in Settings.
 */
async function insertCompanyWithUniqueName(name: string): Promise<{ id?: string; error?: string }> {
  const admin = createAdminClient();
  for (let attempt = 1; attempt <= 25; attempt++) {
    const candidate = attempt === 1 ? name : `${name} (${attempt})`;
    const { data, error } = await admin
      .from("companies")
      .insert({ name: candidate })
      .select("id")
      .single();
    if (!error && data) return { id: (data as { id: string }).id };
    if ((error as { code?: string } | null)?.code !== "23505") {
      return { error: error?.message ?? "Could not create the company." };
    }
  }
  return { error: "That company name is already taken. Try adding your city to it." };
}

/**
 * Builds a working company from nothing: the row, its settings, the owner's
 * membership, and the starter lists without which the app renders empty
 * boards and empty dropdowns (see lib/data/company-defaults.ts).
 *
 * Service role throughout, like createCompany() -- a company this new has
 * no company_members row yet for RLS to check the caller against.
 */
export async function createCompanyWithDefaults(
  name: string,
  ownerProfileId: string
): Promise<{ companyId?: string; error?: string }> {
  const admin = createAdminClient();

  const created = await insertCompanyWithUniqueName(name);
  if (!created.id) return { error: created.error };
  const companyId = created.id;

  const withCompany = <T extends object>(rows: T[]) =>
    rows.map((row) => ({ ...row, company_id: companyId }));

  // Done first and checked, unlike the rest. Every RLS policy in the
  // database reads company_members, so a company whose owner has no row
  // in it is a company nobody can open -- worse than no company at all.
  // Missing starter lists, by contrast, can be typed in by hand.
  const { error: memberError } = await admin.from("company_members").insert({
    profile_id: ownerProfileId,
    company_id: companyId,
    roles: ["Office", "Admin"],
    can_delete_leads: true,
    status: "Active",
  });
  if (memberError) {
    await admin.from("companies").delete().eq("id", companyId);
    return { error: memberError.message };
  }

  await Promise.all([
    admin.from("company_profile").insert({ company_id: companyId, name }),
    admin.from("pipeline_stages").insert(withCompany(DEFAULT_PIPELINE_STAGES)),
    admin.from("calendars").insert(withCompany(DEFAULT_CALENDARS)),
    admin.from("call_dispositions").insert(withCompany(DEFAULT_CALL_DISPOSITIONS)),
    admin.from("project_types").insert(withCompany(DEFAULT_PROJECT_TYPES)),
    admin.from("lead_sources").insert(withCompany(DEFAULT_LEAD_SOURCES)),
  ]);

  return { companyId };
}

function inviteEmailBody(companyName: string, link: string): { html: string; text: string } {
  const safeCompany = escapeHtml(companyName);
  return {
    html:
      `<p>Thanks for signing up${safeCompany ? ` — ${safeCompany}` : ""}.</p>` +
      `<p>One step left: pick a password and your CRM is ready.</p>` +
      `<p><a href="${link}">Finish setting up your account</a></p>` +
      `<p>The link works once and expires in 7 days.</p>`,
    text:
      `Thanks for signing up${companyName ? ` — ${companyName}` : ""}.\n\n` +
      `Finish setting up your account: ${link}\n\n` +
      `The link works once and expires in 7 days.`,
  };
}

/**
 * Turns a paid Checkout Session into an emailed setup link. Safe to call
 * as many times as it happens to be called.
 *
 * Stripe's own guidance is that fulfilment must be driven by webhooks --
 * "you can't rely on triggering fulfillment only from your checkout
 * landing page, because it's not guaranteed customers visit that page" --
 * and that the function "must correctly handle being called multiple
 * times with the same Checkout Session ID". Both apply here: the webhook
 * and the /welcome page call this, the webhook may deliver twice, and a
 * bank debit fires a second event days later when it settles. The unique
 * stripe_session_id column is what makes the second call a no-op.
 */
export async function provisionSignup(
  sessionId: string
): Promise<{ ok: boolean; retryable?: boolean; email?: string; companyName?: string; error?: string }> {
  const env = getStripeEnv();
  if (!env) return { ok: false, error: "Signup isn't configured on this deployment." };
  if (!sessionId) return { ok: false, error: "Missing checkout session." };

  let session: Stripe.Checkout.Session;
  try {
    session = await stripeClient(env).checkout.sessions.retrieve(sessionId);
  } catch {
    return { ok: false, error: "We couldn't find that checkout." };
  }

  // Read straight from Stripe rather than trusting anything that arrived
  // with the request: the session id can come off a URL the customer can
  // edit, so the amount, the status and the email all have to come from
  // the API. 'unpaid' is Stripe's own signal to hold off -- a bank debit
  // sits there until it settles, and fires a second event when it does.
  if (session.payment_status === "unpaid") {
    return { ok: false, error: "This payment hasn't cleared yet. We'll email you the moment it does." };
  }

  const email = (session.customer_details?.email ?? session.customer_email ?? "")
    .trim()
    .toLowerCase();
  const companyName = (session.metadata?.company_name ?? "").trim();
  if (!email) return { ok: false, error: "That checkout has no email address on it." };
  if (!companyName) return { ok: false, error: "That checkout has no company name on it." };

  const { id, token, alreadySent, error } = await createInvite({
    stripeSessionId: session.id,
    email,
    companyName,
    stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
    stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : null,
    priceId: session.metadata?.price_id ?? null,
  });
  // A database fault here is worth retrying, so the caller is told to let
  // Stripe try again rather than swallowing it.
  if (error) return { ok: false, retryable: true, error };

  // Somebody else already sent this one: the other side of the race, or a
  // duplicate delivery. Nothing to do, and for the person waiting the
  // email is already on its way.
  if (alreadySent || !token || !id) return { ok: true, email, companyName };

  const link = registerUrl(token);
  const body = inviteEmailBody(companyName, link);
  const sent = await sendEmail(email, "Finish setting up your Contractor CRM", body.html, body.text);

  // sendEmail reports failures by returning them rather than throwing, so
  // an unchecked call is a signup that silently never arrives. The invite
  // row stays behind with no send time on it, which is what lets the
  // retry mint a fresh code and try again.
  if (sent.error) return { ok: false, retryable: true, error: sent.error };

  await markInviteSent(id);
  return { ok: true, email, companyName };
}
