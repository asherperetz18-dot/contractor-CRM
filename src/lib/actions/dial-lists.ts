"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function saveDialList(
  name: string,
  leadIds: string[]
): Promise<{ error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "List name is required." };
  if (leadIds.length === 0) return { error: "Select at least one contact first." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.from("dial_lists").insert({
    name: trimmed,
    lead_ids: leadIds,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/dial-queue");
  return {};
}

export async function deleteDialList(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.from("dial_lists").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dial-queue");
  return {};
}
