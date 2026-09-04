"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeEnv, stripeClient } from "@/lib/stripe-env";
import { portalBaseUrl } from "@/lib/portal/session";
import { postLoginPath } from "@/lib/landing";
import {
  claimInvite,
  loadUsableInvite,
  recordInviteResult,
  releaseInvite,
} from "@/lib/signup/invites";
import { createCompanyWithDefaults, signupPriceId } from "@/lib/signup/provision";

export type SignupFormState =
  | { error: string; info?: never }
  | { info: string; error?: never }
  | undefined;

/**
 * Starts a paid signup: company name and email in, a Stripe Checkout URL
 * out. Nothing is written to our database here -- an abandoned checkout
 * should leave no trace, and the company only exists once the money does.
 */
export async function startSignupCheckout(input: {
  companyName: string;
  email: string;
}): Promise<{ url?: string; error?: string }> {
  const companyName = input.companyName.trim();
  const email = input.email.trim().toLowerCase();
  if (!companyName) return { error: "Enter your company name." };
  if (!email.includes("@")) return { error: "Enter a valid email address." };

  const env = getStripeEnv();
  const priceId = signupPriceId();
  if (!env || !priceId) return { error: "Signup isn't switched on yet. Get in touch and we'll set you up." };

  const base = portalBaseUrl();
  try {
    const stripe = stripeClient(env);

    // The plan decides its own mode: a recurring price has to be sold in
    // subscription mode and a one-off price in payment mode, and Stripe
    // rejects the wrong pairing outright. Reading it from the price means
    // switching between a monthly plan and a one-time fee is an env var,
    // not a code change.
    const price = await stripe.prices.retrieve(priceId);
    const mode = price.recurring ? "subscription" : "payment";

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      // Carried through to the webhook, which is where the company name
      // is actually needed -- Stripe collects the email and the money,
      // never the name of the business being set up.
      metadata: { kind: "crm_signup", company_name: companyName, price_id: priceId },
      // Stripe's placeholder, substituted for the real session id on the
      // way back. /welcome uses it to provision immediately rather than
      // waiting on webhook delivery.
      success_url: `${base}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/get-started`,
    });

    if (!session.url) return { error: "Couldn't start checkout. Try again." };
    return { url: session.url };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't start checkout." };
  }
}

/**
 * Redeems a setup link: creates the account, the company and its starter
 * lists, then signs the owner in.
 *
 * The email is never taken from the form. It comes off the invite, which
 * came off the Stripe session, which is the address that paid -- so the
 * person setting up an account is the person who received the link there.
 */
export async function completeSignup(
  _prevState: SignupFormState,
  formData: FormData
): Promise<SignupFormState> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!name) return { error: "Enter your name." };
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== confirm) return { error: "The two passwords don't match." };

  const { invite, error: inviteError } = await loadUsableInvite(token);
  if (!invite) return { error: inviteError ?? "This setup link isn't valid." };

  // Taken before anything is created, not after. loadUsableInvite only
  // read consumed_at; acting on what it said left a window in which the
  // same link submitted twice -- two tabs, or an impatient double click --
  // ran the whole creation path twice and produced two companies for one
  // payment. Whoever loses this race gets the message instead.
  if (!(await claimInvite(invite.id))) {
    return { error: "This setup link has already been used — sign in instead." };
  }

  const admin = createAdminClient();

  // Somebody can already have a login here -- they work for another
  // company on the system, or they bought a second CRM. Their existing
  // password is left completely alone: this flow proves control of an
  // inbox, which is not enough to change one.
  // Plain equality, not ilike: an underscore is ordinary in an email
  // address and is a single-character wildcard to LIKE, so ilike would
  // match a different person's account. Both sides are lowercase --
  // Supabase Auth stores the address that way, and createInvite() writes
  // it that way.
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("email", invite.email)
    .maybeSingle();
  const existingId = (existingProfile as { id: string } | null)?.id ?? null;

  if (existingId) {
    const { companyId, error } = await createCompanyWithDefaults(invite.company_name, existingId);
    if (!companyId) {
      await releaseInvite(invite.id);
      return { error: error ?? "Couldn't create the company." };
    }
    await recordInviteResult(invite.id, companyId, existingId);
    return {
      info: `${invite.company_name} is ready. Sign in with your existing password and switch to it from the company menu.`,
    };
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: invite.email,
    password,
    // They arrived by clicking a link sent to this address, which is the
    // same proof a confirmation email would have collected.
    email_confirm: true,
    user_metadata: { name },
  });
  const newUserId = created?.user?.id;
  if (createError || !newUserId) {
    await releaseInvite(invite.id);
    return { error: createError?.message ?? "Couldn't create the account." };
  }

  const { companyId, error: companyError } = await createCompanyWithDefaults(
    invite.company_name,
    newUserId
  );
  if (!companyId) {
    // Roll the account back rather than leave a login with no company
    // behind it -- that is precisely the stuck state this whole flow
    // exists to remove.
    await admin.auth.admin.deleteUser(newUserId);
    await releaseInvite(invite.id);
    return { error: companyError ?? "Couldn't create the company." };
  }

  await recordInviteResult(invite.id, companyId, newUserId);

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: invite.email,
    password,
  });
  // The account exists either way; only the automatic sign-in failed, so
  // send them to the form they can finish it on.
  if (signInError) redirect("/login");

  redirect(await postLoginPath());
}
