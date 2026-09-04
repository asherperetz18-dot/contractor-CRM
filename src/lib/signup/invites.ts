import "server-only";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
// Same public origin the customer portal builds its links from -- there is
// one deployment and one domain, so there is no second answer to derive.
import { portalBaseUrl } from "@/lib/portal/session";

// A week. Long enough to survive a spam folder and a weekend, short
// enough that a forwarded email doesn't stay a live account forever.
const INVITE_TTL_DAYS = 7;

export type SignupInvite = {
  id: string;
  email: string;
  company_name: string;
  expires_at: string;
  consumed_at: string | null;
  company_id: string | null;
};

// Only hashes are stored, so a dump of signup_invites can't be replayed
// to claim somebody's paid signup. Copied deliberately from
// lib/portal/session.ts rather than invented again.
function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function newRawToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function registerUrl(rawToken: string): string {
  return `${portalBaseUrl()}/register?token=${encodeURIComponent(rawToken)}`;
}

function expiryFromNow(): string {
  return new Date(Date.now() + INVITE_TTL_DAYS * 86400000).toISOString();
}

/**
 * Records a paid signup and returns the raw code to put in the email, or
 * nothing when the email has already gone out.
 *
 * The Checkout Session id is unique in the table, so a webhook delivered
 * twice -- or the webhook and the success page racing each other, which
 * is the normal case -- produces one invite and one email.
 *
 * The awkward case is a row that exists with no send time against it: the
 * insert worked and Resend then failed. The raw code from that attempt is
 * gone (only its hash was kept), so the retry mints a new one and
 * overwrites the hash. Nothing is lost, because the code being replaced
 * was never delivered to anybody.
 */
export async function createInvite(input: {
  stripeSessionId: string;
  email: string;
  companyName: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  priceId?: string | null;
}): Promise<{ id?: string; token?: string; alreadySent?: boolean; error?: string }> {
  const admin = createAdminClient();
  // Stored lowercased so it can be matched with a plain equality check
  // later. ILIKE would treat an underscore -- ordinary in an email
  // address -- as a single-character wildcard.
  const email = input.email.trim().toLowerCase();

  const { data: existingRow } = await admin
    .from("signup_invites")
    .select("id, invite_sent_at, consumed_at")
    .eq("stripe_session_id", input.stripeSessionId)
    .maybeSingle();
  const existing = existingRow as
    | { id: string; invite_sent_at: string | null; consumed_at: string | null }
    | null;

  if (existing) {
    if (existing.consumed_at || existing.invite_sent_at) {
      return { id: existing.id, alreadySent: true };
    }
    const retryToken = newRawToken();
    const { error } = await admin
      .from("signup_invites")
      .update({ token_hash: hashToken(retryToken), expires_at: expiryFromNow() })
      .eq("id", existing.id)
      .is("invite_sent_at", null);
    if (error) return { error: error.message };
    return { id: existing.id, token: retryToken };
  }

  const raw = newRawToken();
  const { data, error } = await admin
    .from("signup_invites")
    .insert({
      stripe_session_id: input.stripeSessionId,
      email,
      company_name: input.companyName,
      stripe_customer_id: input.stripeCustomerId ?? null,
      stripe_subscription_id: input.stripeSubscriptionId ?? null,
      price_id: input.priceId ?? null,
      token_hash: hashToken(raw),
      expires_at: expiryFromNow(),
    })
    .select("id")
    .single();

  if (error) {
    // 23505 is a unique violation: the check above lost a race with a
    // concurrent delivery of the same event. That is the constraint doing
    // its job, not a failure -- the other caller is sending the email.
    if ((error as { code?: string }).code === "23505") return { alreadySent: true };
    return { error: error.message };
  }

  return { id: (data as { id: string }).id, token: raw };
}

/** Recorded only once Resend has accepted the message. */
export async function markInviteSent(inviteId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("signup_invites")
    .update({ invite_sent_at: new Date().toISOString() })
    .eq("id", inviteId);
}

/**
 * Looks up an invite by the raw code from the link, refusing anything
 * used, expired or unknown. The messages are deliberately specific:
 * unlike a login form there is nothing to enumerate here, and "which of
 * those three happened" is the only thing the person needs to know.
 */
export async function loadUsableInvite(
  raw: string
): Promise<{ invite?: SignupInvite; error?: string }> {
  if (!raw) return { error: "This setup link is missing its code." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("signup_invites")
    .select("id, email, company_name, expires_at, consumed_at, company_id")
    .eq("token_hash", hashToken(raw))
    .maybeSingle();

  const invite = data as SignupInvite | null;
  if (!invite) return { error: "This setup link isn't valid." };
  if (invite.consumed_at) {
    return { error: "This setup link has already been used — sign in instead." };
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { error: "This setup link has expired. Get in touch and we'll send a new one." };
  }
  return { invite };
}

/** Marks the invite spent and records what it produced. */
export async function consumeInvite(
  inviteId: string,
  companyId: string,
  profileId: string
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("signup_invites")
    .update({
      consumed_at: new Date().toISOString(),
      company_id: companyId,
      profile_id: profileId,
    })
    .eq("id", inviteId)
    .is("consumed_at", null);
}
