"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";

async function requireOfficeOrAdmin(): Promise<{ error: string } | { companyId: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can manage call dispositions." };
  return { companyId: profile.company_id };
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
  if ("error" in guard) return guard;

  const trimmed = name.trim();
  if (!trimmed) return { error: "Disposition name is required." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("call_dispositions")
    .select("sort_order")
    .eq("company_id", guard.companyId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();
  const nextOrder = ((existing as { sort_order: number } | null)?.sort_order ?? 0) + 1;

  const { error } = await supabase.from("call_dispositions").insert({
    name: trimmed,
    color: color || "#7C8798",
    sort_order: nextOrder,
    is_system: false,
    company_id: guard.companyId,
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
  if ("error" in guard) return guard;

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

  await supabase
    .from("call_logs")
    .update({ disposition: trimmed })
    .eq("disposition", current.name)
    .eq("company_id", guard.companyId);

  revalidateDispositionRoutes();
  return {};
}

export async function updateDispositionColor(
  id: string,
  color: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { error } = await supabase.from("call_dispositions").update({ color }).eq("id", id);
  if (error) return { error: error.message };

  revalidateDispositionRoutes();
  return {};
}

export async function deleteDisposition(id: string): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

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
    .eq("disposition", current.name)
    .eq("company_id", guard.companyId);
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
  if ("error" in guard) return guard;

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

/**
 * What a call outcome does to the lead: the stage it moves it to (null
 * for none) and whether it books a follow-up task for the caller.
 *
 * Enforcement note: the move itself is applied forward-only and only to
 * leads still in the pre-appointment stages (dispositionStageMove), so
 * pointing "No Answer" at an early stage can never drag a lead that has
 * progressed back down the pipeline.
 */
export async function updateDispositionRules(
  id: string,
  rules: { moveToStage: string | null; createsFollowupTask: boolean }
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("call_dispositions")
    .update({
      move_to_stage: rules.moveToStage,
      creates_followup_task: rules.createsFollowupTask,
    })
    .eq("id", id)
    .eq("company_id", guard.companyId)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That disposition couldn't be updated." };

  revalidateDispositionRoutes();
  return {};
}
