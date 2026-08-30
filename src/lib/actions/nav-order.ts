"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";

/**
 * Save the company's sidebar order: an array of top-level entry keys
 * (a link's href, or "group:<label>" for a section). Empty means the
 * built-in order. Company-wide on purpose -- the whole team seeing the
 * same menu is what keeps "third item from the top" a sentence that
 * means something.
 */
export async function saveNavOrder(keys: string[]): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return { error: "Office or Admin only." };
  if (!Array.isArray(keys) || keys.length > 50 || keys.some((k) => typeof k !== "string" || k.length > 120)) {
    return { error: "That doesn't look like a menu order." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("company_profile")
    .update({ nav_order: keys })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Could not save the order." };

  revalidatePath("/", "layout");
  revalidatePath("/settings/menu-order");
  return {};
}

export async function resetNavOrder(): Promise<{ error?: string }> {
  return saveNavOrder([]);
}
