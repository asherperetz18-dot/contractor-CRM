"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";

export type ContractTemplate = {
  id: string;
  name: string;
  body: string;
  is_default: boolean;
  updated_at: string;
};

export async function getContractTemplates(): Promise<{
  error?: string;
  templates?: ContractTemplate[];
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_templates")
    .select("id, name, body, is_default, updated_at")
    .eq("company_id", profile.company_id)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true })
    .returns<ContractTemplate[]>();
  if (error) return { error: error.message };
  return { templates: data ?? [] };
}

export async function saveContractTemplate(input: {
  id?: string;
  name: string;
  body: string;
  isDefault: boolean;
}): Promise<{ error?: string; id?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can edit contracts." };

  const name = input.name.trim();
  if (!name) return { error: "Give the contract a name." };
  if (!input.body.trim()) return { error: "The contract is empty." };

  const supabase = await createClient();

  // Cleared first, because the database allows only one default per
  // company. Setting the new one first would collide with the old.
  if (input.isDefault) {
    await supabase
      .from("contract_templates")
      .update({ is_default: false })
      .eq("company_id", profile.company_id)
      .eq("is_default", true);
  }

  const row = {
    name,
    body: input.body,
    is_default: input.isDefault,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("contract_templates")
      .update(row)
      .eq("id", input.id)
      .eq("company_id", profile.company_id)
      .select("id");
    if (error) return { error: error.message };
    // Row count rather than a missing error: a blocked update matches
    // nothing and raises nothing.
    if (!data?.length) return { error: "Couldn't save that contract." };
    revalidatePath("/settings/contracts");
    return { id: input.id };
  }

  const { data, error } = await supabase
    .from("contract_templates")
    .insert({ ...row, company_id: profile.company_id, created_by: profile.id })
    .select("id")
    .returns<{ id: string }[]>();
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Couldn't create that contract." };
  revalidatePath("/settings/contracts");
  return { id: data[0].id };
}

/**
 * Removes a template. Contracts already signed are untouched: their text
 * was copied onto the estimate when it was created, which is the whole
 * reason it is copied.
 */
export async function deleteContractTemplate(id: string): Promise<{ error?: string; ok?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can do that." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_templates")
    .delete()
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Couldn't delete that contract." };
  revalidatePath("/settings/contracts");
  return { ok: true };
}
