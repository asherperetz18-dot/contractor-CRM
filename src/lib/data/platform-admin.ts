import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type PlatformAdminRow = {
  id: string;
  name: string | null;
  email: string | null;
};

/**
 * Everyone who currently holds is_platform_admin, for the management
 * page. Expected to stay a short list -- this is meant to be a handful
 * of people, not a roster -- so no paging.
 *
 * Not a "use server" action: only ever called from platform-admin/page.tsx
 * during render, which is itself behind PlatformAdminGate. Reading the
 * list needs no guard of its own the way granting and revoking do,
 * exactly as getCompanyMembers has none beyond its caller's page gate.
 */
export async function listPlatformAdmins(): Promise<PlatformAdminRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, name, email")
    .eq("is_platform_admin", true)
    .order("name");
  return (data as PlatformAdminRow[] | null) ?? [];
}
