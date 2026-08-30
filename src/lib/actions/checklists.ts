"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { normalizeTemplateItems, dueFromOffset, type TemplateItem } from "@/lib/checklist-auto";

export type ChecklistTemplate = {
  id: string;
  name: string;
  items: TemplateItem[];
  auto_apply: boolean;
  updated_at: string;
};

export type ProjectChecklistItem = {
  id: string;
  estimate_id: string;
  label: string;
  sort_order: number;
  due_date: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  completed_by: string | null;
};

const MAX_ITEMS = 100;
const MAX_LABEL = 200;

function cleanTemplateItems(items: { label: string; offsetDays: number | null }[]): TemplateItem[] {
  return items
    .map((it) => ({
      label: it.label.trim().replace(/^[-•*☐]\s*/, "").slice(0, MAX_LABEL),
      offset_days:
        it.offsetDays !== null && Number.isFinite(it.offsetDays)
          ? Math.max(0, Math.min(365, Math.round(it.offsetDays)))
          : null,
    }))
    .filter((it) => it.label)
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
    .select("id, name, items, auto_apply, updated_at")
    .eq("company_id", profile.company_id)
    .order("name", { ascending: true })
    .returns<{ id: string; name: string; items: unknown; auto_apply: boolean; updated_at: string }[]>();
  if (error) return { error: error.message };
  return {
    templates: (data ?? []).map((t) => ({ ...t, items: normalizeTemplateItems(t.items) })),
  };
}

export async function saveChecklistTemplate(input: {
  id?: string;
  name: string;
  items: { label: string; offsetDays: number | null }[];
  autoApply: boolean;
}): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can edit templates." };

  const name = input.name.trim();
  if (!name) return { error: "Give the template a name." };
  const items = cleanTemplateItems(input.items);
  if (!items.length) return { error: "Add at least one step." };

  const supabase = await createClient();

  // One auto-apply template per company: two lists both claiming every
  // new contract would double the checklist, so turning it on here
  // turns it off everywhere else.
  if (input.autoApply) {
    await supabase
      .from("checklist_templates")
      .update({ auto_apply: false })
      .eq("company_id", profile.company_id)
      .eq("auto_apply", true);
  }

  if (input.id) {
    const { data, error } = await supabase
      .from("checklist_templates")
      .update({ name, items, auto_apply: input.autoApply, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("company_id", profile.company_id)
      .select("id");
    if (error) return { error: error.message };
    if (!data?.length) return { error: "Template not found." };
  } else {
    const { error } = await supabase
      .from("checklist_templates")
      .insert({ company_id: profile.company_id, name, items, auto_apply: input.autoApply });
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
  const [{ data: template }, { data: existing }, { data: estimate }] = await Promise.all([
    supabase
      .from("checklist_templates")
      .select("items")
      .eq("id", templateId)
      .eq("company_id", profile.company_id)
      .maybeSingle<{ items: unknown }>(),
    supabase
      .from("project_checklist_items")
      .select("label, sort_order")
      .eq("estimate_id", estimateId)
      .returns<{ label: string; sort_order: number }[]>(),
    supabase
      .from("estimates")
      .select("signed_at")
      .eq("id", estimateId)
      .maybeSingle<{ signed_at: string | null }>(),
  ]);
  if (!template) return { error: "Template not found." };

  // Offsets count from the signing day; an unsigned job counts from
  // today, which is the only day it has.
  const base = estimate?.signed_at ?? new Date().toISOString();

  const have = new Set((existing ?? []).map((i) => i.label.trim().toLowerCase()));
  let sort = Math.max(-1, ...(existing ?? []).map((i) => i.sort_order)) + 1;
  const rows = normalizeTemplateItems(template.items)
    .filter((it) => !have.has(it.label.trim().toLowerCase()))
    .map((it) => ({
      company_id: profile.company_id,
      estimate_id: estimateId,
      label: it.label,
      sort_order: sort++,
      due_date: it.offset_days !== null ? dueFromOffset(base, it.offset_days) : null,
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

/**
 * Sets a step's planned date and/or owner. Same gate as reshaping the
 * list: dates and owners are plans, and plans are Office/Admin work.
 */
export async function updateProjectChecklistItem(
  itemId: string,
  patch: { dueDate?: string | null; assignedTo?: string | null }
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change the list." };

  const fields: Record<string, string | null> = {};
  if (patch.dueDate !== undefined) fields.due_date = patch.dueDate || null;
  if (patch.assignedTo !== undefined) fields.assigned_to = patch.assignedTo || null;
  if (!Object.keys(fields).length) return {};

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_checklist_items")
    .update(fields)
    .eq("id", itemId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Couldn't save that step." };
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
