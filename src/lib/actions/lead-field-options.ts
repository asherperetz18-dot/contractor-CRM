"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type OptionTable = "project_types" | "lead_sources";

function columnFor(table: OptionTable): "project_type" | "source" {
  return table === "project_types" ? "project_type" : "source";
}

function settingsPathFor(table: OptionTable): string {
  return table === "project_types" ? "/settings/project-types" : "/settings/lead-sources";
}

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
    return { error: "Only Office or Admin users can manage this list." };
  }
  return {};
}

function revalidate(table: OptionTable) {
  revalidatePath(settingsPathFor(table));
  revalidatePath("/pipeline");
  revalidatePath("/contacts");
}

export async function createFieldOption(
  table: OptionTable,
  name: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const trimmed = name.trim();
  if (!trimmed) return { error: "Name is required." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from(table)
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();
  const nextOrder = ((existing as { sort_order: number } | null)?.sort_order ?? 0) + 1;

  const { error } = await supabase.from(table).insert({ name: trimmed, sort_order: nextOrder });
  if (error) {
    if (error.code === "23505") return { error: "That option already exists." };
    return { error: error.message };
  }

  revalidate(table);
  return {};
}

export async function renameFieldOption(
  table: OptionTable,
  id: string,
  name: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const trimmed = name.trim();
  if (!trimmed) return { error: "Name is required." };

  const supabase = await createClient();
  const { data: row } = await supabase.from(table).select("name").eq("id", id).single();
  const current = row as { name: string } | null;
  if (!current) return { error: "Not found." };
  if (current.name === trimmed) return {};

  const { error } = await supabase.from(table).update({ name: trimmed }).eq("id", id);
  if (error) {
    if (error.code === "23505") return { error: "That option already exists." };
    return { error: error.message };
  }

  // Keep existing leads pointed at the renamed value.
  const column = columnFor(table);
  const patch: Record<string, string> = {};
  patch[column] = trimmed;
  await supabase.from("leads").update(patch).eq(column, current.name);

  revalidate(table);
  return {};
}

export async function deleteFieldOption(
  table: OptionTable,
  id: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const supabase = await createClient();
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) return { error: error.message };

  revalidate(table);
  return {};
}

export async function reorderFieldOptions(
  table: OptionTable,
  orderedIds: string[]
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const supabase = await createClient();
  const results = await Promise.all(
    orderedIds.map((id, index) => supabase.from(table).update({ sort_order: index + 1 }).eq("id", id))
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  revalidate(table);
  return {};
}
