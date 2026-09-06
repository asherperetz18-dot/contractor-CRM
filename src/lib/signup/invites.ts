import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
// Shared with the customer portal's magic links rather than kept as a
// second copy that can drift -- see lib/crypto/link-tokens.ts.
import { hashLinkToken as hashToken, newLinkToken as newRawToken } from "@/lib/crypto/link-tokens";
// Same public origin the customer portal builds its links from -- there is
// one deployment and one domain, so there is no second answer to derive.
import { portalBaseUrl } from "@/lib/portal/session";

// A week. Long enough to survive a spam folder and a weekend, short
// enough that a forwarded email doesn't stay a live account forever.
// Exported because the email and the confirmation page both quote it --
// a constant nobody can read is a constant three copies of "7 days" go
// stale behind.
export const INVITE_TTL_DAYS = 7;

// How long an unsent row gets the benefit of the doubt before createInvite
// will rotate its token. sendEmail is one HTTPS call to Resend -- seconds,
// not tens of seconds, even under load -- so this is a wide margin, not a
// tight deadline: it exists to outlast a legitimate in-flight send, not to
// bound one.
const RETRY_GRACE_MS = 20_000;

export type SignupInvite = {
  id: string;
  email: string;
  // Null on an invite an admin sent by hand (createManualInvite): nobody
  // has typed a company name yet at that point, unlike a paid signup,
  // which always has one from the Get Started form before Stripe is ever
  // reached. /register asks for it itself when this is null.
  company_name: string | null;
  expires_at: string;
  consumed_at: string | null;
};

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
 * is the normal case -- produces one invite and one email. That race is
 * also why an existing row with no send time is not automatically a
 * retry candidate: it's just as often the other concurrent caller's row,
 * inserted moments ago and still being mailed out. See RETRY_GRACE_MS.
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
    .select("id, token_hash, invite_sent_at, consumed_at, created_at")
    .eq("stripe_session_id", input.stripeSessionId)
    .maybeSingle();
  const existing = existingRow as
    | {
        id: string;
        token_hash: string;
        invite_sent_at: string | null;
        consumed_at: string | null;
        created_at: string;
      }
    | null;

  if (existing) {
    if (existing.consumed_at || existing.invite_sent_at) {
      return { id: existing.id, alreadySent: true };
    }

    // A row this fresh is not a retry candidate -- it is the ordinary
    // shape of the race this file already calls normal, caught one step
    // earlier. The webhook and /welcome can both reach this branch for a
    // row the FIRST caller only just inserted a moment ago and has not
    // finished sending yet: markInviteSent happens after a real network
    // call to Resend, so "not yet marked sent" does not mean "abandoned"
    // for a good few seconds. Rotating the hash here would invalidate the
    // link the original sender is mid-flight on. RETRY_GRACE_MS is far
    // longer than a single Resend call ever takes; treating this as
    // "somebody else has it" costs an extra few seconds before a
    // genuinely failed send gets retried, which is cheap next to mailing
    // a link that stops working the moment a second request touches it.
    const ageMs = Date.now() - new Date(existing.created_at).getTime();
    if (ageMs < RETRY_GRACE_MS) return { id: existing.id, alreadySent: true };

    const retryToken = newRawToken();
    // `.is("invite_sent_at", null)` alone is not exclusive: it stays true
    // for every concurrent caller until the winner finishes sending and
    // calls markInviteSent. Pinning the update to the exact token_hash
    // just read turns it into a compare-and-swap on top of the age
    // check above -- if two callers both clear the grace window at
    // nearly the same instant, only the one whose read is still current
    // wins, and the other's update matches zero rows, same as if the row
    // had already been marked sent.
    const { data, error } = await admin
      .from("signup_invites")
      .update({ token_hash: hashToken(retryToken), expires_at: expiryFromNow() })
      .eq("id", existing.id)
      .eq("token_hash", existing.token_hash)
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
 * The other door in: an Office/Admin user invites a specific address
 * directly, no payment involved. Always a fresh row -- unlike the paid
 * path there is no Stripe session id to dedupe repeat webhook delivery
 * against, and there is no repeat delivery to guard against either; this
 * runs once, when someone on the team clicks the button.
 *
 * company_name is left unset. The register page collects it from the
 * person redeeming the link instead (see completeSignup), since nobody
 * on this path has typed one in yet.
 */
export async function createManualInvite(
  email: string
): Promise<{ id?: string; token?: string; error?: string }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return { error: "Enter a valid email address." };

  const admin = createAdminClient();
  const raw = newRawToken();
  const { data, error } = await admin
    .from("signup_invites")
    .insert({
      email: normalized,
      company_name: null,
      source: "manual",
      token_hash: hashToken(raw),
      expires_at: expiryFromNow(),
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
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
