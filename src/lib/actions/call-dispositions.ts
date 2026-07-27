"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
    return { error: "Only Office or Admin users can manage call dispositions." };
  }
  return {};
}

function revalidateDispositionRoutes() {
  revalidatePath("/settings/call-dispositions");
  revalidatePath("/dial-queue");
  revalidatePath("/call-reports");
}

export async function createDisposition(
  name: string,
  color: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const trimmed = name.trim();
  if (!trimmed) return { error: "Disposition name is required." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("call_dispositions")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();
  const nextOrder = ((existing as { sort_order: number } | null)?.sort_order ?? 0) + 1;

  const { error } = await supabase.from("call_dispositions").insert({
    name: trimmed,
    color: color || "#7C8798",
    sort_order: nextOrder,
    is_system: false,
  });
  if (error) {
    if (error.code === "23505") return { error: "A disposition with that name already exists." };
    return { error: error.message };
  }

  revalidateDispositionRoutes();
  return {};
}

export async function renameDisposition(
  id: string,
  name: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const trimmed = name.trim();
  if (!trimmed) return { error: "Disposition name is required." };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("call_dispositions")
    .select("name, is_system")
    .eq("id", id)
    .single();
  const current = row as { name: string; is_system: boolean } | null;
  if (!current) return { error: "Disposition not found." };
  if (current.is_system) return { error: "System dispositions cannot be renamed." };
  if (current.name === trimmed) return {};

  const { error } = await supabase
    .from("call_dispositions")
    .update({ name: trimmed })
    .eq("id", id);
  if (error) {
    if (error.code === "23505") return { error: "A disposition with that name already exists." };
    return { error: error.message };
  }

  await supabase.from("call_logs").update({ disposition: trimmed }).eq("disposition", current.name);

  revalidateDispositionRoutes();
  return {};
}

export async function updateDispositionColor(
  id: string,
  color: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const supabase = await createClient();
  const { error } = await supabase.from("call_dispositions").update({ color }).eq("id", id);
  if (error) return { error: error.message };

  revalidateDispositionRoutes();
  return {};
}

export async function deleteDisposition(id: string): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("call_dispositions")
    .select("name, is_system")
    .eq("id", id)
    .single();
  const current = row as { name: string; is_system: boolean } | null;
  if (!current) return { error: "Disposition not found." };
  if (current.is_system) return { error: "System dispositions cannot be deleted." };

  const { count } = await supabase
    .from("call_logs")
    .select("id", { count: "exact", head: true })
    .eq("disposition", current.name);
  if (count && count > 0) {
    return {
      error: `${count} call${count === 1 ? "" : "s"} still use this disposition. Reassign them first.`,
    };
  }

  const { error } = await supabase.from("call_dispositions").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidateDispositionRoutes();
  return {};
}

export async function reorderDispositions(orderedIds: string[]): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const supabase = await createClient();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("call_dispositions").update({ sort_order: index + 1 }).eq("id", id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  revalidateDispositionRoutes();
  return {};
}
