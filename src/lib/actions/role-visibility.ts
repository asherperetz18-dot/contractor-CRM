"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, PageKey } from "@/lib/data/types";

async function requireOfficeOrAdmin(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("roles")
    .eq("id", user.id)
    .single();
  const roles = (profile as { roles: string[] } | null)?.roles ?? [];
  if (!roles.includes("Office") && !roles.includes("Admin")) {
    return { error: "Only Office or Admin users can manage role visibility." };
  }
  return {};
}

export async function setPageVisibility(
  role: AppRole,
  pageKey: PageKey,
  visible: boolean
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const supabase = await createClient();
  const { error } = await supabase
    .from("role_page_visibility")
    .upsert({ role, page_key: pageKey, visible }, { onConflict: "role,page_key" });
  if (error) return { error: error.message };

  revalidatePath("/settings/role-visibility");
  revalidatePath("/", "layout");
  return {};
}
