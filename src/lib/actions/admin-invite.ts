"use server";

import { getCurrentProfile } from "@/lib/data/profile";
import { isPlatformAdmin } from "@/lib/data/types";
import { sendEmail } from "@/lib/email-env";
import { createManualInvite, markInviteSent, registerUrl } from "@/lib/signup/invites";
import { manualInviteEmailBody } from "@/lib/signup/provision";

/**
 * The manual door: a Platform Admin sends a setup link straight to an
 * address of their choosing, no payment involved. Everything past
 * "here's an email, send the link" -- the account, the new company, the
 * starter lists -- runs through the exact same /register page and
 * completeSignup() as a paid signup. The only difference the rest of the
 * system has to know about is that this invite's company_name starts
 * out null, because nobody has typed one in yet.
 *
 * Gated on isPlatformAdmin, not isAdminRole. This shipped checking
 * isAdminRole originally -- Office or Admin of whichever company the
 * caller happens to be viewing -- which meant any paying customer's own
 * Office or Admin user could mint brand-new companies on the platform
 * for free. Onboarding a new tenant is a platform-operator action, not a
 * run-my-own-company one; see migration 0132.
 *
 * Kept in its own file rather than folded into lib/actions/signup.ts:
 * that file is reachable by anyone with no session at all, and this one
 * is not -- a single file mixing "public, unauthenticated" actions with
 * "Platform Admin only" ones is exactly the kind of thing a later reader
 * skims past and gets wrong.
 */
export async function sendManualSignupInvite(email: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isPlatformAdmin(profile)) return { error: "Only a Platform Admin can do this." };

  const { id, token, error } = await createManualInvite(email);
  if (error) return { error };
  if (!id || !token) return { error: "Couldn't create the invite." };

  const link = registerUrl(token);
  const body = manualInviteEmailBody(link);
  const sent = await sendEmail(email.trim().toLowerCase(), "Set up your Contractor CRM account", body.html, body.text);
  // Unlike the paid flow, nothing else will ever retry this send -- there
  // is no webhook, no /welcome page revisiting the same session. If
  // Resend fails, this is the only chance, so it is reported as a real
  // error rather than swallowed behind a generic success.
  if (sent.error) return { error: sent.error };

  // The email is what matters and it already went out, so a failure to
  // record that does not fail the action -- it just means invite_sent_at
  // undersells what actually happened. Logged rather than surfaced,
  // since re-clicking Send here would (harmlessly) mail a second link.
  const marked = await markInviteSent(id);
  if (marked.error) {
    console.error(`[signup] manual invite ${id} sent but not marked: ${marked.error}`);
  }

  return {};
}
