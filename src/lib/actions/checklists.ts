"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";

export type ChecklistTemplate = {
  id: string;
  name: string;
  items: string[];
  updated_at: string;
};

export type ProjectChecklistItem = {
  id: string;
  estimate_id: string;
  label: string;
  sort_order: number;
  completed_at: string | null;
  completed_by: string | null;
};

const MAX_ITEMS = 100;
const MAX_LABEL = 200;

/** One item per line, trimmed, empties dropped, leading bullets stripped. */
function parseItems(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim().replace(/^[-•*☐]\s*/, "").slice(0, MAX_LABEL))
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
}

export async function getChecklistTemplates(): Promise<{
  error?: string;
  templates?: ChecklistTemplate[];
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("checklist_templates")
    .select("id, name, items, updated_at")
    .eq("company_id", profile.company_id)
    .order("name", { ascending: true })
    .returns<ChecklistTemplate[]>();
  if (error) return { error: error.message };
  return { templates: data ?? [] };
}

export async function saveChecklistTemplate(input: {
  id?: string;
  name: string;
  itemsText: string;
}): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can edit templates." };

  const name = input.name.trim();
  if (!name) return { error: "Give the template a name." };
  const items = parseItems(input.itemsText);
  if (!items.length) return { error: "Add at least one item — one per line." };

  const supabase = await createClient();
  if (input.id) {
    const { data, error } = await supabase
      .from("checklist_templates")
      .update({ name, items, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("company_id", profile.company_id)
      .select("id");
    if (error) return { error: error.message };
    if (!data?.length) return { error: "Template not found." };
  } else {
    const { error } = await supabase
      .from("checklist_templates")
      .insert({ company_id: profile.company_id, name, items });
    if (error) return { error: error.message };
  }
  revalidatePath("/settings/checklist-templates");
  revalidatePath("/projects");
  return {};
}

export async function deleteChecklistTemplate(id: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can edit templates." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("checklist_templates")
    .delete()
    .eq("id", id)
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };
  revalidatePath("/settings/checklist-templates");
  revalidatePath("/projects");
  return {};
}

/**
 * Copies a template's items onto a project. Items already on the list
 * (same wording, case-blind) are skipped rather than duplicated, so
 * applying twice -- or applying a second template that shares steps --
 * doesn't double the work.
 */
export async function applyChecklistTemplate(
  estimateId: string,
  templateId: string
): Promise<{ error?: string; added?: number }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change the list." };

  const supabase = await createClient();
  const [{ data: template }, { data: existing }] = await Promise.all([
    supabase
      .from("checklist_templates")
      .select("items")
      .eq("id", templateId)
      .eq("company_id", profile.company_id)
      .maybeSingle<{ items: string[] }>(),
    supabase
      .from("project_checklist_items")
      .select("label, sort_order")
      .eq("estimate_id", estimateId)
      .returns<{ label: string; sort_order: number }[]>(),
  ]);
  if (!template) return { error: "Template not found." };

  const have = new Set((existing ?? []).map((i) => i.label.trim().toLowerCase()));
  let sort = Math.max(-1, ...(existing ?? []).map((i) => i.sort_order)) + 1;
  const rows = (template.items ?? [])
    .filter((label) => !have.has(label.trim().toLowerCase()))
    .map((label) => ({
      company_id: profile.company_id,
      estimate_id: estimateId,
      label,
      sort_order: sort++,
    }));
  if (!rows.length) return { added: 0 };

  const { error } = await supabase.from("project_checklist_items").insert(rows);
  if (error) return { error: error.message };
  revalidatePath("/projects");
  return { added: rows.length };
}

export async function addProjectChecklistItem(
  estimateId: string,
  label: string
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change the list." };
  const trimmed = label.trim().slice(0, MAX_LABEL);
  if (!trimmed) return { error: "Type the item first." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("project_checklist_items")
    .select("sort_order")
    .eq("estimate_id", estimateId)
    .returns<{ sort_order: number }[]>();
  const sort = Math.max(-1, ...(existing ?? []).map((i) => i.sort_order)) + 1;

  const { error } = await supabase.from("project_checklist_items").insert({
    company_id: profile.company_id,
    estimate_id: estimateId,
    label: trimmed,
    sort_order: sort,
  });
  if (error) return { error: error.message };
  revalidatePath("/projects");
  return {};
}

export async function setProjectChecklistItemDone(
  itemId: string,
  done: boolean
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_checklist_items")
    .update(
      done
        ? { completed_at: new Date().toISOString(), completed_by: profile.id }
        : { completed_at: null, completed_by: null }
    )
    .eq("id", itemId)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Couldn't save that — your role may not have permission." };
  revalidatePath("/projects");
  return {};
}

export async function deleteProjectChecklistItem(itemId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change the list." };
  const supabase = await createClient();
  const { error } = await supabase.from("project_checklist_items").delete().eq("id", itemId);
  if (error) return { error: error.message };
  revalidatePath("/projects");
  return {};
}
