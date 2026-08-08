"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canCreateEstimates, canViewEstimates, type ScopeTemplate } from "@/lib/data/types";

export async function listScopeTemplates(): Promise<ScopeTemplate[]> {
  const profile = await getCurrentProfile();
  if (!profile || !canViewEstimates(profile)) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("scope_templates")
    .select("*")
    .eq("company_id", profile.company_id)
    .order("project_type", { ascending: true, nullsFirst: true })
    .order("name", { ascending: true })
    .returns<ScopeTemplate[]>();
  return data ?? [];
}

export async function saveScopeTemplate(input: {
  id?: string;
  name: string;
  projectType: string | null;
  body: string;
}): Promise<{ error?: string; id?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canCreateEstimates(profile)) {
    return { error: "You don't have permission to edit the scope library." };
  }
  const name = input.name.trim();
  const body = input.body.trim();
  if (!name) return { error: "Give the example a name." };
  if (!body) return { error: "The scope can't be empty." };

  const supabase = await createClient();
  const row = {
    name,
    project_type: input.projectType || null,
    body,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("scope_templates")
      .update(row)
      .eq("id", input.id)
      .eq("company_id", profile.company_id)
      .select("id");
    if (error) return { error: error.message };
    if (!data?.length) return { error: "That example couldn't be saved." };
    revalidatePath("/settings/scope-library");
    return { id: input.id };
  }

  const { data, error } = await supabase
    .from("scope_templates")
    .insert({ ...row, company_id: profile.company_id, created_by: profile.id })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) return { error: error.message };
  if (!data) return { error: "That example couldn't be saved." };
  revalidatePath("/settings/scope-library");
  return { id: data.id };
}

export async function deleteScopeTemplate(id: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canCreateEstimates(profile)) {
    return { error: "You don't have permission to edit the scope library." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scope_templates")
    .delete()
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That example couldn't be deleted." };
  revalidatePath("/settings/scope-library");
  return {};
}
