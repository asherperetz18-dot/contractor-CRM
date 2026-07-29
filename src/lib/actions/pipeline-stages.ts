"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole, SYSTEM_STAGE_NAMES } from "@/lib/data/types";

async function requireOfficeOrAdmin(): Promise<{ error: string } | { companyId: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can manage pipeline stages." };
  return { companyId: profile.company_id };
}

export async function createStage(
  name: string,
  color: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const trimmed = name.trim();
  if (!trimmed) return { error: "Stage name is required." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("pipeline_stages")
    .select("sort_order")
    .eq("company_id", guard.companyId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();
  const nextOrder = ((existing as { sort_order: number } | null)?.sort_order ?? 0) + 1;

  const { error } = await supabase.from("pipeline_stages").insert({
    name: trimmed,
    color: color || "#7C8798",
    sort_order: nextOrder,
    is_system: false,
    company_id: guard.companyId,
  });
  if (error) {
    if (error.code === "23505") return { error: "A stage with that name already exists." };
    return { error: error.message };
  }

  revalidatePath("/settings/pipeline-stages");
  revalidatePath("/pipeline");
  return {};
}

export async function renameStage(
  id: string,
  name: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const trimmed = name.trim();
  if (!trimmed) return { error: "Stage name is required." };

  const supabase = await createClient();
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("name, is_system")
    .eq("id", id)
    .single();
  const current = stage as { name: string; is_system: boolean } | null;
  if (!current) return { error: "Stage not found." };
  if (current.is_system) return { error: "System stages cannot be renamed." };
  if (current.name === trimmed) return {};

  const { error } = await supabase
    .from("pipeline_stages")
    .update({ name: trimmed })
    .eq("id", id);
  if (error) {
    if (error.code === "23505") return { error: "A stage with that name already exists." };
    return { error: error.message };
  }

  // Keep existing leads pointed at the renamed stage (this company's
  // only -- stage names aren't unique across companies).
  await supabase
    .from("leads")
    .update({ stage: trimmed })
    .eq("stage", current.name)
    .eq("company_id", guard.companyId);

  revalidatePath("/settings/pipeline-stages");
  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  return {};
}

export async function updateStageColor(
  id: string,
  color: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { error } = await supabase
    .from("pipeline_stages")
    .update({ color })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/settings/pipeline-stages");
  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  return {};
}

export async function deleteStage(id: string): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("name, is_system")
    .eq("id", id)
    .single();
  const current = stage as { name: string; is_system: boolean } | null;
  if (!current) return { error: "Stage not found." };
  if (current.is_system || SYSTEM_STAGE_NAMES.includes(current.name)) {
    return { error: "System stages cannot be deleted." };
  }

  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("stage", current.name)
    .eq("company_id", guard.companyId);
  if (count && count > 0) {
    return {
      error: `${count} lead${count === 1 ? "" : "s"} still use this stage. Move them first.`,
    };
  }

  const { error } = await supabase.from("pipeline_stages").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/settings/pipeline-stages");
  revalidatePath("/pipeline");
  return {};
}

export async function reorderStages(orderedIds: string[]): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("pipeline_stages").update({ sort_order: index + 1 }).eq("id", id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  revalidatePath("/settings/pipeline-stages");
  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  return {};
}
