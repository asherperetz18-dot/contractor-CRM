"use server";

import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { sendEmail } from "@/lib/email-env";
import { createManualInvite, markInviteSent, registerUrl } from "@/lib/signup/invites";
import { manualInviteEmailBody } from "@/lib/signup/provision";

/**
 * The manual door: an Office/Admin user sends a setup link straight to
 * an address of their choosing, no payment involved. Everything past
 * "here's an email, send the link" -- the account, the new company, the
 * starter lists -- runs through the exact same /register page and
 * completeSignup() as a paid signup. The only difference the rest of the
 * system has to know about is that this invite's company_name starts
 * out null, because nobody has typed one in yet.
 *
 * Kept in its own file rather than folded into lib/actions/signup.ts:
 * that file is reachable by anyone with no session at all, and this one
 * is not -- a single file mixing "public, unauthenticated" actions with
 * "Office/Admin only" ones is exactly the kind of thing a later reader
 * skims past and gets wrong.
 */
export async function sendManualSignupInvite(email: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can do this." };

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
