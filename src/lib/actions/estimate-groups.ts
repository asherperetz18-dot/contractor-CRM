"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import type { EstimateGroup } from "@/lib/data/types";

const COLUMNS = "id, estimate_id, name, description, sort_order";

export async function getEstimateGroups(
  estimateId: string
): Promise<{ error?: string; groups?: EstimateGroup[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimate_groups")
    .select(COLUMNS)
    .eq("estimate_id", estimateId)
    .eq("company_id", profile.company_id)
    .order("sort_order", { ascending: true })
    .returns<EstimateGroup[]>();
  if (error) return { error: error.message };
  return { groups: data ?? [] };
}

/**
 * Refuses to change a document the customer has signed.
 *
 * A section heading and its subtotal are part of what was agreed --
 * renaming "Kitchen" to "Kitchen and utility" after signature changes
 * what the contract appears to cover.
 */
async function assertUnsigned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  estimateId: string,
  companyId: string
): Promise<{ error?: string }> {
  const { data } = await supabase
    .from("estimates")
    .select("status")
    .eq("id", estimateId)
    .eq("company_id", companyId)
    .maybeSingle<{ status: string }>();
  if (!data) return { error: "That document couldn't be found." };
  if (data.status === "Signed" || data.status === "Void") {
    return { error: "This document is closed — its sections can't be changed." };
  }
  return {};
}

export async function createEstimateGroup(
  estimateId: string,
  name: string
): Promise<{ error?: string; group?: EstimateGroup }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!name.trim()) return { error: "Give the section a name." };

  const supabase = await createClient();
  const frozen = await assertUnsigned(supabase, estimateId, profile.company_id);
  if (frozen.error) return frozen;

  // Appended, not inserted at the top: sections are read in order and a
  // new one belongs after the work already described.
  const { data: last } = await supabase
    .from("estimate_groups")
    .select("sort_order")
    .eq("estimate_id", estimateId)
    .eq("company_id", profile.company_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();

  const { data, error } = await supabase
    .from("estimate_groups")
    .insert({
      company_id: profile.company_id,
      estimate_id: estimateId,
      name: name.trim(),
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select(COLUMNS)
    .returns<EstimateGroup>()
    .single();
  if (error) return { error: error.message };

  revalidatePath("/estimates");
  return { group: data };
}

export async function updateEstimateGroup(
  groupId: string,
  changes: { name?: string; description?: string | null }
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("estimate_groups")
    .select("estimate_id")
    .eq("id", groupId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ estimate_id: string }>();
  if (!row) return { error: "Section not found." };
  const frozen = await assertUnsigned(supabase, row.estimate_id, profile.company_id);
  if (frozen.error) return frozen;

  const patch: Record<string, unknown> = {};
  if (changes.name !== undefined) {
    if (!changes.name.trim()) return { error: "A section needs a name." };
    patch.name = changes.name.trim();
  }
  if (changes.description !== undefined) {
    patch.description = changes.description?.trim() || null;
  }

  const { data, error } = await supabase
    .from("estimate_groups")
    .update(patch)
    .eq("id", groupId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That section couldn't be updated." };

  revalidatePath("/estimates");
  return {};
}

/**
 * Removes the heading. The lines inside it stay on the estimate and
 * become ungrouped.
 *
 * The foreign key is set-null rather than cascade for the same reason:
 * somebody tidying up headings must not silently delete $12,000 of
 * cabinets and find out when the total moves.
 */
export async function deleteEstimateGroup(groupId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("estimate_groups")
    .select("estimate_id")
    .eq("id", groupId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ estimate_id: string }>();
  if (!row) return { error: "Section not found." };
  const frozen = await assertUnsigned(supabase, row.estimate_id, profile.company_id);
  if (frozen.error) return frozen;

  const { data, error } = await supabase
    .from("estimate_groups")
    .delete()
    .eq("id", groupId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That section couldn't be removed." };

  revalidatePath("/estimates");
  return {};
}
