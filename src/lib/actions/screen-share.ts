"use server";

import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { getTwilioForCompany } from "@/lib/twilio-company";

export type ActiveShare = {
  id: string;
  token: string;
  sharerId: string;
  sharerName: string;
  startedAt: string;
  /** Who this share is aimed at; null means anyone on the team. */
  invitedTo: string | null;
};

/**
 * Starts a sharing session: the row is how teammates discover it, the
 * token is the ticket into the signaling channel. Any session this
 * person left dangling (a closed laptop never says goodbye) is ended
 * first, so one sharer never shows as two live sessions.
 *
 * With invitedTo, the session is aimed at one teammate: only they (and
 * the sharer) can read the row at all -- RLS since 0116 -- so the rest
 * of the company never even sees the banner.
 */
export async function startScreenShare(invitedTo?: string | null): Promise<{
  error?: string;
  id?: string;
  token?: string;
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  // The invitee must be an active member of THIS company. Checked with
  // the admin client because the value lands in a column that decides
  // row visibility -- an unvalidated uuid would let a session be aimed
  // at a stranger, which reads as "nobody can join".
  if (invitedTo) {
    const admin = createAdminClient();
    const { data: member } = await admin
      .from("company_members")
      .select("profile_id")
      .eq("profile_id", invitedTo)
      .eq("company_id", profile.company_id)
      .eq("status", "Active")
      .maybeSingle();
    if (!member) return { error: "That teammate isn't on this company." };
  }

  const supabase = await createClient();
  await supabase
    .from("screen_shares")
    .update({ ended_at: new Date().toISOString() })
    .eq("sharer_id", profile.id)
    .is("ended_at", null);

  const token = crypto.randomBytes(16).toString("hex");
  const { data, error } = await supabase
    .from("screen_shares")
    .insert({
      company_id: profile.company_id,
      sharer_id: profile.id,
      token,
      invited_to: invitedTo ?? null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: (data as { id: string }).id, token };
}

/**
 * Teammates the picker can aim a share at: active members of the
 * caller's company, minus the caller. Names via the admin client
 * because profiles carries no company column of its own.
 */
export async function getShareTargets(): Promise<{
  error?: string;
  targets?: { id: string; name: string }[];
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const admin = createAdminClient();
  const { data: members } = await admin
    .from("company_members")
    .select("profile_id")
    .eq("company_id", profile.company_id)
    .eq("status", "Active");
  const ids = [...new Set(((members as { profile_id: string }[]) ?? []).map((m) => m.profile_id))].filter(
    (id) => id !== profile.id
  );
  if (!ids.length) return { targets: [] };

  const { data: profs } = await admin.from("profiles").select("id, name, email").in("id", ids);
  const targets = (((profs as { id: string; name: string | null; email: string | null }[]) ?? [])
    .map((p) => ({ id: p.id, name: p.name || p.email || "Teammate" }))
    .sort((a, b) => a.name.localeCompare(b.name)));
  return { targets };
}

export async function endScreenShare(id: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  const supabase = await createClient();
  await supabase
    .from("screen_shares")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", id)
    .eq("sharer_id", profile.id);
  return {};
}

/**
 * The company's live sessions, for the "X is sharing their screen"
 * banner. Sessions older than 4 hours are treated as abandoned -- a
 * browser that crashed mid-share never wrote ended_at.
 */
export async function getActiveShares(): Promise<{ error?: string; shares?: ActiveShare[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const cutoff = new Date(Date.now() - 4 * 3600e3).toISOString();
  // RLS (0116) already hides sessions aimed at somebody else; this
  // select simply never receives a token that isn't this caller's to
  // have.
  const { data, error } = await supabase
    .from("screen_shares")
    .select("id, token, sharer_id, started_at, invited_to")
    .eq("company_id", profile.company_id)
    .is("ended_at", null)
    .gte("started_at", cutoff)
    .order("started_at", { ascending: false });
  if (error) return { error: error.message };

  const rows =
    (data as { id: string; token: string; sharer_id: string; started_at: string; invited_to: string | null }[]) ?? [];
  if (!rows.length) return { shares: [] };

  const admin = createAdminClient();
  const { data: profs } = await admin
    .from("profiles")
    .select("id, name, email")
    .in("id", [...new Set(rows.map((r) => r.sharer_id))]);
  const nameById = new Map(
    ((profs as { id: string; name: string | null; email: string | null }[]) ?? []).map((p) => [
      p.id,
      p.name || p.email || "A teammate",
    ])
  );

  return {
    shares: rows.map((r) => ({
      id: r.id,
      token: r.token,
      sharerId: r.sharer_id,
      sharerName: nameById.get(r.sharer_id) ?? "A teammate",
      startedAt: r.started_at,
      invitedTo: r.invited_to ?? null,
    })),
  };
}

/**
 * ICE servers for the peer connection. Google's STUN is enough when
 * both sides have friendly networks; Twilio's Network Traversal
 * Service adds TURN relays for the office-firewall and LTE cases.
 * Twilio being down or unconfigured degrades to STUN-only rather than
 * failing the call.
 */
export async function getIceServers(): Promise<{ iceServers: RTCIceServer[] }> {
  const fallback: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const profile = await getCurrentProfile();
  if (!profile) return { iceServers: fallback };

  try {
    const twilio = await getTwilioForCompany(profile.company_id);
    if (!twilio) return { iceServers: fallback };
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Tokens.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString("base64")}`,
        },
      }
    );
    if (!res.ok) return { iceServers: fallback };
    const body = (await res.json()) as {
      ice_servers?: { url?: string; urls?: string; username?: string; credential?: string }[];
    };
    const servers: RTCIceServer[] = (body.ice_servers ?? []).map((s) => ({
      urls: s.urls ?? s.url ?? "",
      ...(s.username ? { username: s.username } : {}),
      ...(s.credential ? { credential: s.credential } : {}),
    }));
    return { iceServers: servers.length ? servers : fallback };
  } catch {
    return { iceServers: fallback };
  }
}
