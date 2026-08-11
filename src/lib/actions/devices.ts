"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";

export type DeviceRow = {
  id: string;
  profile_id: string;
  personName: string;
  label: string;
  first_seen_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  isCurrent: boolean;
};

/**
 * Records that this device is in use, and reports whether it still may be.
 *
 * Called from the same heartbeat that already tracks activity, so it
 * costs one extra write on a timer that was running anyway.
 *
 * Returns revoked so the browser can act on it. Cutting a device off has
 * to reach that device somehow, and this is the only channel that already
 * runs on it -- there is no push. That makes revocation take effect
 * within one heartbeat rather than instantly, which is the honest limit
 * of doing it this way and is written on the settings screen.
 */
export async function touchDevice(
  deviceId: string,
  userAgent: string,
  label: string
): Promise<{ revoked?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile || !deviceId) return {};

  const supabase = await createClient();
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("user_devices")
    .select("id, revoked_at")
    .eq("profile_id", profile.id)
    .eq("device_id", deviceId)
    .maybeSingle<{ id: string; revoked_at: string | null }>();

  if (existing) {
    // A revoked device is not touched: last_seen_at would keep ticking and
    // the row would read as active while the point of it is that the
    // device is finished.
    if (existing.revoked_at) return { revoked: true };
    await supabase.from("user_devices").update({ last_seen_at: now }).eq("id", existing.id);
    return {};
  }

  await supabase.from("user_devices").insert({
    profile_id: profile.id,
    company_id: profile.company_id,
    device_id: deviceId,
    user_agent: userAgent.slice(0, 400),
    label,
    first_seen_at: now,
    last_seen_at: now,
  });
  return {};
}

/** Everyone signed in across the company, newest activity first. */
export async function getCompanyDevices(
  currentDeviceId?: string
): Promise<{ error?: string; devices?: DeviceRow[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can see this." };

  // Service role for the names only: profiles is readable per RLS, but a
  // list keyed by uuid is not a list anyone can act on.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_devices")
    .select("id, profile_id, device_id, label, first_seen_at, last_seen_at, revoked_at")
    .eq("company_id", profile.company_id)
    .order("last_seen_at", { ascending: false })
    .returns<
      {
        id: string;
        profile_id: string;
        device_id: string;
        label: string | null;
        first_seen_at: string;
        last_seen_at: string;
        revoked_at: string | null;
      }[]
    >();
  if (error) return { error: error.message };

  const ids = [...new Set((data ?? []).map((d) => d.profile_id))];
  const { data: people } = await admin
    .from("profiles")
    .select("id, name, email")
    .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
    .returns<{ id: string; name: string | null; email: string | null }[]>();
  const nameById = new Map((people ?? []).map((p) => [p.id, p.name || p.email || "Unnamed"]));

  return {
    devices: (data ?? []).map((d) => ({
      id: d.id,
      profile_id: d.profile_id,
      personName: nameById.get(d.profile_id) ?? "Unnamed",
      label: d.label || "Unknown device",
      first_seen_at: d.first_seen_at,
      last_seen_at: d.last_seen_at,
      revoked_at: d.revoked_at,
      // Marked so nobody signs themselves out wondering what the button did.
      isCurrent: !!currentDeviceId && d.device_id === currentDeviceId,
    })),
  };
}

/** Cuts a device off. It signs itself out on its next heartbeat. */
export async function revokeDevice(id: string): Promise<{ error?: string; ok?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can do that." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_devices")
    .update({ revoked_at: new Date().toISOString(), revoked_by: profile.id })
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .select("id");
  // Row count rather than a missing error: a blocked update matches
  // nothing and raises nothing, which would report success.
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Couldn't revoke that device." };

  revalidatePath("/settings/devices");
  return { ok: true };
}

/** Lets a device back in — for the inevitable "that was mine". */
export async function restoreDevice(id: string): Promise<{ error?: string; ok?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can do that." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_devices")
    .update({ revoked_at: null, revoked_by: null })
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Couldn't restore that device." };

  revalidatePath("/settings/devices");
  return { ok: true };
}
