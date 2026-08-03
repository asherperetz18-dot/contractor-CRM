import "server-only";
import crypto from "crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Lead } from "@/lib/data/types";

export const PORTAL_COOKIE = "portal_session";

const LOGIN_TOKEN_TTL_MINUTES = 30;
const SESSION_TTL_DAYS = 30;

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

/**
 * Trades a valid magic-link token for a portal session and sets the cookie.
 * The token is burned on use, so a link forwarded or sitting in an inbox
 * can't be replayed after the first sign-in.
 */
export async function consumeLoginToken(raw: string): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("portal_login_tokens")
    .select("id, lead_id, company_id, expires_at, consumed_at")
    .eq("token_hash", hashToken(raw))
    .maybeSingle();

  const token = row as {
    id: string;
    lead_id: string;
    company_id: string;
    expires_at: string;
    consumed_at: string | null;
  } | null;

  if (!token) return { error: "This sign-in link isn't valid." };
  if (token.consumed_at) return { error: "This sign-in link has already been used." };
  if (new Date(token.expires_at).getTime() < Date.now()) {
    return { error: "This sign-in link has expired." };
  }

  await admin
    .from("portal_login_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", token.id);

  const sessionRaw = newRawToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400000);
  const { error } = await admin.from("portal_sessions").insert({
    lead_id: token.lead_id,
    company_id: token.company_id,
    token_hash: hashToken(sessionRaw),
    expires_at: expiresAt.toISOString(),
  });
  if (error) return { error: error.message };

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
