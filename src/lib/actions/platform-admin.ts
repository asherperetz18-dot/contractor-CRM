"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/data/profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdmin } from "@/lib/data/types";

/**
 * Every write in this file needs the SAME check independently of the
 * page: a server action is a real endpoint, reachable directly with the
 * right request whether or not anything renders a button for it --
 * PlatformAdminGate on the page is not a substitute for this.
 */
async function requirePlatformAdmin(): Promise<{ error: string } | { actorId: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isPlatformAdmin(profile)) return { error: "Only a Platform Admin can do this." };
  return { actorId: profile.id };
}

async function logAudit(
  action: "grant" | "revoke",
  actorId: string,
  targetId: string
): Promise<void> {
  const admin = createAdminClient();
  await admin.from("platform_admin_audit").insert({
    actor_profile_id: actorId,
    target_profile_id: targetId,
    action,
  });
}

/**
 * Grants is_platform_admin to whoever holds this email today. Requires
 * an existing account -- this proves nothing about an inbox the way the
 * signup invite flow's tokens do, so it only ever acts on somebody who
 * has already signed in at least once.
 */
export async function grantPlatformAdmin(email: string): Promise<{ error?: string }> {
  const guard = await requirePlatformAdmin();
  if ("error" in guard) return guard;

  // Plain equality, not ilike: an underscore is ordinary in an email
  // address and a single-character wildcard to LIKE. profiles.email is
  // stored lowercased (Supabase Auth's own normalisation), so this only
  // needs to match that.
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return { error: "Enter a valid email address." };

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("id, is_platform_admin")
    .eq("email", normalized)
    .maybeSingle();
  const targetRow = target as { id: string; is_platform_admin: boolean | null } | null;
  if (!targetRow) {
    return { error: "No account exists yet for that email — they need to sign in at least once first." };
  }
  if (targetRow.is_platform_admin === true) return {}; // Already one; nothing to do.

  const { error } = await admin
    .from("profiles")
    .update({ is_platform_admin: true })
    .eq("id", targetRow.id);
  if (error) return { error: error.message };

  await logAudit("grant", guard.actorId, targetRow.id);
  revalidatePath("/platform-admin");
  return {};
}

/**
 * Removes is_platform_admin from a specific profile. Self-revoke is
 * allowed -- stepping down is ordinary, the same reasoning
 * updateUserRoles already applies to a company's own Admin role -- as
 * long as it isn't the platform's last one.
 *
 * "Would this leave zero" can't be checked here and then acted on in a
 * second call: two people revoking each other at the same instant would
 * each see "someone else still holds it" before either write commits,
 * and both revokes would go through. revoke_platform_admin_if_not_last
 * (migration 0132) does the check and the write in one round trip,
 * serialised by an advisory lock, so that race isn't reachable.
 */
export async function revokePlatformAdmin(targetProfileId: string): Promise<{ error?: string }> {
  const guard = await requirePlatformAdmin();
  if ("error" in guard) return guard;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("revoke_platform_admin_if_not_last", {
    p_target_id: targetProfileId,
  });
  if (error) return { error: error.message };

  const outcome = data as "revoked" | "refused_last" | "not_admin";
  if (outcome === "refused_last") {
    return { error: "This is the only Platform Admin left — grant someone else Platform Admin first." };
  }
  if (outcome === "not_admin") return {}; // Already not one; nothing to do.

  await logAudit("revoke", guard.actorId, targetProfileId);
  revalidatePath("/platform-admin");
  return {};
}
