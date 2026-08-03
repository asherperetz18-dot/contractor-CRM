import "server-only";
import crypto from "crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Lead } from "@/lib/data/types";

export const PORTAL_COOKIE = "portal_session";
// Holds a validated-but-not-yet-redeemed magic link while the customer
// answers the street-number challenge.
export const PORTAL_PENDING_COOKIE = "portal_pending";

const LOGIN_TOKEN_TTL_MINUTES = 30;
const SESSION_TTL_DAYS = 30;
const MAX_CHALLENGE_ATTEMPTS = 5;

/**
 * The street number from a free-text address, or null when there isn't one.
 * Most addresses in this data are just a city ("Malibu"), so callers must
 * handle null rather than assume every customer can be challenged.
 */
export function streetNumberOf(address: string | null): string | null {
  const match = (address || "").trim().match(/^(\d+)/);
  return match ? match[1] : null;
}

// Only hashes are ever stored, so a dump of portal_login_tokens or
// portal_sessions can't be replayed to sign in as a customer.
function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function newRawToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Issues a single-use magic-link token for a lead. Returns the raw token,
 * which is the only time it exists in plaintext -- it goes straight into
 * the link we send and is never persisted.
 */
export async function createLoginToken(
  leadId: string,
  companyId: string
): Promise<{ token?: string; error?: string }> {
  const raw = newRawToken();
  const admin = createAdminClient();
  const { error } = await admin.from("portal_login_tokens").insert({
    lead_id: leadId,
    company_id: companyId,
    token_hash: hashToken(raw),
    expires_at: new Date(Date.now() + LOGIN_TOKEN_TTL_MINUTES * 60000).toISOString(),
  });
  if (error) return { error: error.message };
  return { token: raw };
}

type TokenRow = {
  id: string;
  lead_id: string;
  company_id: string;
  expires_at: string;
  consumed_at: string | null;
  attempts: number;
};

async function loadUsableToken(
  raw: string
): Promise<{ token?: TokenRow; error?: string }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("portal_login_tokens")
    .select("id, lead_id, company_id, expires_at, consumed_at, attempts")
    .eq("token_hash", hashToken(raw))
    .maybeSingle();

  const token = data as TokenRow | null;
  if (!token) return { error: "This sign-in link isn't valid." };
  if (token.consumed_at) return { error: "This sign-in link has already been used." };
  if (new Date(token.expires_at).getTime() < Date.now()) {
    return { error: "This sign-in link has expired." };
  }
  return { token };
}

/**
 * Validates a magic link without redeeming it, and reports whether the
 * customer still has to answer the street-number challenge.
 *
 * The link is parked in a short-lived cookie rather than left in the URL,
 * so it isn't preserved in history or leaked by a Referer header while the
 * challenge page is open.
 */
export async function beginLogin(
  raw: string
): Promise<{ error?: string; needsChallenge?: boolean }> {
  const { token, error } = await loadUsableToken(raw);
  if (error || !token) return { error };

  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("address")
    .eq("id", token.lead_id)
    .maybeSingle();

  const expected = streetNumberOf((lead as { address: string | null } | null)?.address ?? null);

  // Most addresses on file are just a city, with no number to ask for.
  // Those customers sign in on the link alone rather than being locked out.
  if (!expected) {
    const redeemed = await redeemToken(raw);
    return redeemed.error ? { error: redeemed.error } : { needsChallenge: false };
  }

  const store = await cookies();
  store.set(PORTAL_PENDING_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(token.expires_at),
  });
  return { needsChallenge: true };
}

/**
 * Which company the parked sign-in link belongs to, so the passcode screen
 * can be branded. Resolvable here (unlike the email-entry screen) because
 * the link already identifies the customer.
 */
export async function getPendingChallengeCompany(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(PORTAL_PENDING_COOKIE)?.value;
  if (!raw) return null;
  const { token } = await loadUsableToken(raw);
  return token?.company_id ?? null;
}

/**
 * Checks the street number against the parked link and, if it matches,
 * signs the customer in. Wrong answers are counted against the token and
 * burn it after a handful, so a 3-5 digit number can't be walked through.
 */
export async function completeChallenge(
  answer: string
): Promise<{ error?: string; remaining?: number }> {
  const store = await cookies();
  const raw = store.get(PORTAL_PENDING_COOKIE)?.value;
  if (!raw) return { error: "Your sign-in link expired. Please request a new one." };

  const { token, error } = await loadUsableToken(raw);
  if (error || !token) {
    store.delete(PORTAL_PENDING_COOKIE);
    return { error };
  }

  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("address")
    .eq("id", token.lead_id)
    .maybeSingle();
  const expected = streetNumberOf((lead as { address: string | null } | null)?.address ?? null);
  if (!expected) {
    const redeemed = await redeemToken(raw);
    store.delete(PORTAL_PENDING_COOKIE);
    return redeemed.error ? { error: redeemed.error } : {};
  }

  if (answer.trim() !== expected) {
    const attempts = token.attempts + 1;
    const exhausted = attempts >= MAX_CHALLENGE_ATTEMPTS;
    await admin
      .from("portal_login_tokens")
      .update({
        attempts,
        // Burn the link outright rather than just refusing, so an
        // attacker can't keep guessing until it expires on its own.
        ...(exhausted ? { consumed_at: new Date().toISOString() } : {}),
      })
      .eq("id", token.id);

    if (exhausted) {
      store.delete(PORTAL_PENDING_COOKIE);
      return { error: "Too many incorrect attempts. Please request a new sign-in link." };
    }
    return {
      error: "That doesn't match the address we have on file.",
      remaining: MAX_CHALLENGE_ATTEMPTS - attempts,
    };
  }

  const redeemed = await redeemToken(raw);
  store.delete(PORTAL_PENDING_COOKIE);
  return redeemed.error ? { error: redeemed.error } : {};
}

/**
 * Burns the magic link and issues the session cookie. Single-use, so a
 * link sitting in an inbox can't be replayed after the first sign-in.
 */
async function redeemToken(raw: string): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { token, error } = await loadUsableToken(raw);
  if (error || !token) return { error };

  await admin
    .from("portal_login_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", token.id);

  const sessionRaw = newRawToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400000);
  const { error: insertError } = await admin.from("portal_sessions").insert({
    lead_id: token.lead_id,
    company_id: token.company_id,
    token_hash: hashToken(sessionRaw),
    expires_at: expiresAt.toISOString(),
  });
  if (insertError) return { error: insertError.message };

  const store = await cookies();
  store.set(PORTAL_COOKIE, sessionRaw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return {};
}

export type PortalViewer = {
  lead: Lead;
  companyId: string;
};

/**
 * Resolves the signed-in customer from the session cookie. Every portal
 * page and action goes through this -- it is the single place that decides
 * whose data the portal is allowed to touch.
 */
export async function getPortalViewer(): Promise<PortalViewer | null> {
  const store = await cookies();
  const raw = store.get(PORTAL_COOKIE)?.value;
  if (!raw) return null;

  const admin = createAdminClient();
  const { data: sessionRow } = await admin
    .from("portal_sessions")
    .select("id, lead_id, company_id, expires_at")
    .eq("token_hash", hashToken(raw))
    .maybeSingle();

  const session = sessionRow as {
    id: string;
    lead_id: string;
    company_id: string;
    expires_at: string;
  } | null;
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  const { data: lead } = await admin
    .from("leads")
    .select("*")
    .eq("id", session.lead_id)
    .maybeSingle();
  if (!lead) return null;

  return { lead: lead as Lead, companyId: session.company_id };
}

export async function destroyPortalSession(): Promise<void> {
  const store = await cookies();
  const raw = store.get(PORTAL_COOKIE)?.value;
  if (raw) {
    const admin = createAdminClient();
    await admin.from("portal_sessions").delete().eq("token_hash", hashToken(raw));
  }
  store.delete(PORTAL_COOKIE);
}
