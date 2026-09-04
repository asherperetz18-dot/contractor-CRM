"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, escapeHtml } from "@/lib/email-env";
import { postLoginPath } from "@/lib/landing";

export type AuthFormState = { error: string; info?: never } | { info: string; error?: never } | undefined;

export async function login(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  // Straight to a page this role can actually see. Landing on "/" and
  // letting the layout re-redirect looped the router for anyone whose
  // Dashboard is hidden -- a frozen white tab right after signing in.
  redirect(await postLoginPath());
}

// The open signup() action that used to live here is gone, not merely
// unlinked from the form. An exported server action is an endpoint: it
// keeps answering on its action id whether or not anything renders a
// button for it. It called supabase.auth.signUp directly, which creates a
// login with no company and no company_members row -- an account that can
// sign in and reach nothing. Paid signups go through
// lib/actions/signup.ts, which creates the company in the same breath.

/**
 * Email a password-reset link.
 *
 * Sent through the app's own email service rather than Supabase's SMTP,
 * so it works without dashboard configuration; the link carries the
 * recovery token hash and lands on /reset-password, which redeems it.
 * The response never says whether the address has an account -- a login
 * page that confirms which emails exist is a staff directory for
 * anybody who asks.
 */
export async function requestPasswordReset(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const done = {
    info: "If that email has an account, a reset link is on its way. Check your inbox.",
  };
  if (!email) return { error: "Enter your email address." };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data?.properties?.hashed_token) return done;

  const hdrs = await headers();
  const origin = hdrs.get("origin") || "https://crm.aibuildpros.com";
  const link = origin + "/reset-password?token_hash=" + encodeURIComponent(data.properties.hashed_token);

  await sendEmail(
    email,
    "Reset your Contractor CRM password",
    '<p>Somebody asked to reset the password for ' + escapeHtml(email) + ".</p>" +
      '<p><a href="' + link + '">Set a new password</a></p>' +
      "<p>The link works once and expires after an hour. If this wasn't you, you can ignore this email — your password is unchanged.</p>",
    "Set a new password: " + link +
      "\nThe link works once and expires after an hour. If this wasn't you, ignore this email."
  );
  return done;
}

/**
 * Redeem a recovery link and set the new password.
 *
 * verifyOtp with the token hash both proves the email link was real and
 * signs the person in, so a successful reset lands them on the
 * dashboard rather than back at the login form.
 */
export async function resetPassword(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== confirm) return { error: "The two passwords don't match." };

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "recovery",
    token_hash: tokenHash,
  });
  if (verifyError) {
    return {
      error: "That reset link has expired or was already used — request a new one from the login page.",
    };
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  redirect(await postLoginPath());
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
