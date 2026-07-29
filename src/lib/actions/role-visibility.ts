"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole, type AppRole, type PageKey } from "@/lib/data/types";

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
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { error } = await supabase
    .from("role_page_visibility")
    .upsert(
      { role, page_key: pageKey, visible, company_id: guard.companyId },
      { onConflict: "company_id,role,page_key" }
    );
  if (error) return { error: error.message };

  revalidatePath("/settings/role-visibility");
  revalidatePath("/", "layout");
  return {};
}
