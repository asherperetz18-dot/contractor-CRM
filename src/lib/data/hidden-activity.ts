import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { canSeeActivityOf } from "@/lib/data/activity-visibility";
import type { Profile } from "@/lib/data/types";

/**
 * The people whose activity `viewer` may not see -- every super admin,
 * unless the viewer is one (canSeeActivityOf). For narrowing a read of
 * activity_events or lead_views with `.not("user_id", "in", ...)`.
 *
 * The flag is read with the service role, globally rather than from one
 * company's roster: a super admin can hold a membership the roster hides
 * (a Platform Admin's, 0132), and their activity there hides the same.
 * An error is handed back rather than read as "nobody to hide", which
 * would show the very rows this exists to keep out.
 */
export async function hiddenActivityUserIds(
  viewer: Pick<Profile, "is_super_admin">
): Promise<{ error?: string; ids?: string[] }> {
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id, is_super_admin")
    .eq("is_super_admin", true);
  if (error) return { error: error.message };
  const people = (data ?? []) as { id: string; is_super_admin: boolean }[];
  return { ids: people.filter((p) => !canSeeActivityOf(viewer, p)).map((p) => p.id) };
}
