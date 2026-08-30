"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { defaultPageVisible, isAdminRole, type AppRole, type PageKey } from "@/lib/data/types";
import { revalidateRoleVisibility } from "@/lib/data/company-chrome";

async function requireOfficeOrAdmin(): Promise<{ error: string } | { companyId: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can manage role visibility." };
  return { companyId: profile.company_id };
}

export async function setPageVisibility(
  role: AppRole,
  pageKey: PageKey,
  visible: boolean
): Promise<{ error?: string }> {
  return setPageVisibilityBulk([{ role, pageKey, visible }]);
}

/**
 * Saves a whole batch of cells at once.
 *
 * Every toggle used to be its own request, and each one called
 * revalidatePath("/", "layout") -- rebuilding the entire app shell.
 * Configuring one role meant sixteen clicks, sixteen round-trips and
 * sixteen full-layout rebuilds. One upsert and one revalidate now covers
 * however many cells were changed.
 */
export async function setPageVisibilityBulk(
  changes: { role: AppRole; pageKey: PageKey; visible: boolean }[]
): Promise<{ error?: string; saved?: number }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;
  if (changes.length === 0) return { saved: 0 };

  const supabase = await createClient();

  // A cell set back to what the platform already does is not an override.
  // Storing one anyway would leave it marked "you set this" forever and
  // pin it to today's default if that default ever changes.
  const toStore = changes.filter((c) => c.visible !== defaultPageVisible(c.role, c.pageKey));
  const toClear = changes.filter((c) => c.visible === defaultPageVisible(c.role, c.pageKey));

  if (toStore.length > 0) {
    const { error } = await supabase.from("role_page_visibility").upsert(
      toStore.map((c) => ({
        role: c.role,
        page_key: c.pageKey,
        visible: c.visible,
        company_id: guard.companyId,
      })),
      { onConflict: "company_id,role,page_key" }
    );
    if (error) return { error: error.message };
  }

  for (const c of toClear) {
    const { error } = await supabase
      .from("role_page_visibility")
      .delete()
      .eq("company_id", guard.companyId)
      .eq("role", c.role)
      .eq("page_key", c.pageKey);
    if (error) return { error: error.message };
  }

  revalidateRoleVisibility(guard.companyId);
  revalidatePath("/settings/role-visibility");
  revalidatePath("/", "layout");
  return { saved: changes.length };
}

/**
 * Deletes override rows so those cells fall back to the platform default
 * again. Passing nothing clears every override for the company.
 */
export async function resetPageVisibility(
  scope: { role?: AppRole; pageKey?: PageKey } = {}
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  let query = supabase.from("role_page_visibility").delete().eq("company_id", guard.companyId);
  if (scope.role) query = query.eq("role", scope.role);
  if (scope.pageKey) query = query.eq("page_key", scope.pageKey);

  const { error } = await query;
  if (error) return { error: error.message };

  revalidateRoleVisibility(guard.companyId);
  revalidatePath("/settings/role-visibility");
  revalidatePath("/", "layout");
  return {};
}
