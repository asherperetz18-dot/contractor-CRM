import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashLinkToken, newLinkToken } from "@/lib/crypto/link-tokens";
// Same public origin the customer portal builds its links from -- there is
// one deployment and one domain, so there is no second answer to derive.
import { portalBaseUrl } from "@/lib/portal/session";

// A week. Long enough to survive a spam folder and a weekend, short
// enough that a forwarded email doesn't stay a live account forever.
// Exported because the email and the confirmation page both quote it --
// a constant nobody can read is a constant three copies of "7 days" go
// stale behind.
export const INVITE_TTL_DAYS = 7;

export type SignupInvite = {
  id: string;
  email: string;
  company_name: string;
  expires_at: string;
  consumed_at: string | null;
};

// Only hashes are stored, so a dump of signup_invites can't be replayed
// to claim somebody's paid signup. Shared with the customer portal's
// magic links rather than copied into a second place that can drift --
// see lib/crypto/link-tokens.ts.
const hashToken = hashLinkToken;
const newRawToken = newLinkToken;

export function registerUrl(rawToken: string): string {
  return `${portalBaseUrl()}/register?token=${encodeURIComponent(rawToken)}`;
}

function expiryFromNow(): string {
  return new Date(Date.now() + INVITE_TTL_DAYS * 86400000).toISOString();
}

/**
 * What we already know about a checkout, if anything.
 *
 * Everything /welcome renders is in this row, so a reload, a bookmark, a
 * back-navigation or the second of the two webhooks a bank debit fires
 * can all be answered from here. Without it every one of those pays a
 * Stripe round trip to be told there is nothing to do.
 */
export async function sentInviteForSession(
  stripeSessionId: string
): Promise<{ email: string; company_name: string } | null> {
  if (!stripeSessionId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("signup_invites")
    .select("email, company_name, invite_sent_at")
    .eq("stripe_session_id", stripeSessionId)
    .maybeSingle();
  const row = data as
    | { email: string; company_name: string; invite_sent_at: string | null }
    | null;
  // A row with no send time is the retry case, which has to go back to
  // Stripe -- it still needs a fresh code minted and an email sent.
  return row?.invite_sent_at ? { email: row.email, company_name: row.company_name } : null;
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
    // .select() matters here, and not for the data. Without it a PostgREST
    // update that matches no rows is indistinguishable from one that
    // matched: both come back with no error. The select turns "somebody
    // else sent this while I was reading it" -- the exact race this file
    // says is normal -- into an empty result instead of a link whose hash
    // was never stored, which the customer would click and be told was
    // invalid.
    const { data, error } = await admin
      .from("signup_invites")
      .update({ token_hash: hashToken(retryToken), expires_at: expiryFromNow() })
      .eq("id", existing.id)
      .is("invite_sent_at", null)
      .select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) return { id: existing.id, alreadySent: true };
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

/**
 * Recorded only once Resend has accepted the message.
 *
 * The failure is reported rather than swallowed. A row left saying
 * "unsent" when the email did go out is the one state that actively
 * harms: the next retry mints a fresh code and overwrites the hash,
 * killing the link already sitting in the customer's inbox.
 */
export async function markInviteSent(inviteId: string): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("signup_invites")
    .update({ invite_sent_at: new Date().toISOString() })
    .eq("id", inviteId);
  return error ? { error: error.message } : {};
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
    .select("id, email, company_name, expires_at, consumed_at")
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

/**
 * Takes the invite before anything is created with it.
 *
 * Reading `consumed_at` and then acting on what it said is not enough:
 * the same link opened in two tabs, or double-clicked, gets through both
 * reads and builds two companies for one payment. The claim is a single
 * conditional update -- Postgres serialises the two writers on the row,
 * so exactly one of them sees a row come back.
 */
export async function claimInvite(inviteId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("signup_invites")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", inviteId)
    .is("consumed_at", null)
    .select("id");
  return Boolean(data && data.length > 0);
}

/**
 * Hands a claimed invite back when the work behind it failed, so the
 * customer can simply click their link again instead of holding a receipt
 * for an account that was never created.
 */
export async function releaseInvite(inviteId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("signup_invites").update({ consumed_at: null }).eq("id", inviteId);
}

/** Records what a redeemed invite actually produced. */
export async function recordInviteResult(
  inviteId: string,
  companyId: string,
  profileId: string
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("signup_invites")
    .update({ company_id: companyId, profile_id: profileId })
    .eq("id", inviteId);
}
