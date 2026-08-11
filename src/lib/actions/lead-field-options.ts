"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import { isAdminRole } from "@/lib/data/types";

export type OptionTable = "project_types" | "lead_sources";

function columnFor(table: OptionTable): "project_type" | "source" {
  return table === "project_types" ? "project_type" : "source";
}

function settingsPathFor(table: OptionTable): string {
  return table === "project_types" ? "/settings/project-types" : "/settings/lead-sources";
}

async function requireOfficeOrAdmin(): Promise<{ error: string } | { companyId: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can manage this list." };
  return { companyId: profile.company_id };
}

// Adding a brand-new option (e.g. while filling out a lead) is lower-risk
// than renaming/deleting a shared list, so it's allowed for anyone who can
// edit leads at all -- same roles as canEditDispatch(), plus Admin.
async function requireCanEditLeads(): Promise<{ error: string } | { companyId: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  const roles = profile.roles;
  if (!roles.includes("Office") && !roles.includes("Admin") && !roles.includes("Sales")) {
    return { error: "You don't have permission to add new options." };
  }
  return { companyId: profile.company_id };
}

function revalidate(table: OptionTable) {
  revalidatePath(settingsPathFor(table));
  revalidatePath("/pipeline");
  revalidatePath("/contacts");
}

export type FieldValueUsage = {
  value: string;
  leads: number;
  totalValue: number;
  /** Configured in the settings list, rather than only present on leads. */
  configured: boolean;
};

/** Values that are the same thing typed differently. */
export type FieldValueCluster = { key: string; values: FieldValueUsage[] };

/**
 * Loosened for comparison only, never for storage: case, punctuation and
 * spacing folded away so "CA Pro Guarantee", "CA pro guaranteed" and
 * "CA PRO GUARANTEED" collapse to one key. Trailing "s" and "d" go too,
 * which is what separates "guarantee" from "guaranteed" and "Angies"
 * from "Angie".
 */
function foldValue(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/(s|d)$/, "");
}

/**
 * Every value actually in use, from the leads themselves rather than the
 * settings list.
 *
 * The list is not the truth: this company has 50 distinct sources on its
 * leads and 38 of them were never added as options, so anything working
 * from the configured list alone cannot see -- let alone fix -- most of
 * the mess. Counts and totals come along because deciding which spelling
 * to keep is a decision about which one the money is under.
 */
export async function getFieldValueUsage(
  table: OptionTable
): Promise<{ error?: string; values?: FieldValueUsage[]; clusters?: FieldValueCluster[] }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const column = columnFor(table);
  const supabase = await createClient();
  const [rows, { data: options }] = await Promise.all([
    selectAll<Record<string, string | number | null>>((rangeFrom, rangeTo) =>
      supabase
        .from("leads")
        .select(`${column}, value`)
        .eq("company_id", guard.companyId)
        .range(rangeFrom, rangeTo)
    ),
    supabase.from(table).select("name").eq("company_id", guard.companyId),
  ]);

  const configured = new Set(((options ?? []) as { name: string }[]).map((o) => o.name));
  const tally = new Map<string, { leads: number; totalValue: number }>();
  for (const r of rows) {
    const raw = r[column];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const entry = tally.get(raw) ?? { leads: 0, totalValue: 0 };
    entry.leads += 1;
    entry.totalValue += Number(r.value) || 0;
    tally.set(raw, entry);
  }

  const values: FieldValueUsage[] = [...tally.entries()]
    .map(([value, t]) => ({ value, ...t, configured: configured.has(value) }))
    .sort((a, b) => b.leads - a.leads);

  const byKey = new Map<string, FieldValueUsage[]>();
  for (const v of values) {
    const k = foldValue(v.value);
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), v]);
  }
  const clusters = [...byKey.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, values: group }))
    .sort((a, b) => b.values.length - a.values.length);

  return { values, clusters };
}

/**
 * Folds several spellings into one.
 *
 * Works on the values, not on option rows, because most of them are not
 * option rows. Every lead carrying one of `from` is repointed at `into`,
 * then any matching option rows are removed and `into` is made a real
 * option if it was not already -- otherwise the tidy-up leaves the list
 * describing reality less well than before.
 */
export async function mergeFieldValues(
  table: OptionTable,
  from: string[],
  into: string
): Promise<{ error?: string; moved?: number }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

  const target = into.trim();
  if (!target) return { error: "Choose the spelling to keep." };
  const sources = [...new Set(from.map((f) => f.trim()).filter((f) => f && f !== target))];
  if (sources.length === 0) return { error: "Choose at least one other value to merge in." };

  const column = columnFor(table);
  const supabase = await createClient();

  const patch: Record<string, string> = { [column]: target };
  const { data: moved, error } = await supabase
    .from("leads")
    .update(patch)
    .eq("company_id", guard.companyId)
    .in(column, sources)
    .select("id");
  // Row count rather than a missing error: an RLS-blocked update matches
  // nothing and raises nothing, which would report a merge that never
  // happened.
  if (error) return { error: error.message };

  // The surviving spelling has to exist as an option, or the list still
  // will not offer the one everything now points at.
  const { data: existing } = await supabase
    .from(table)
    .select("id")
    .eq("company_id", guard.companyId)
    .eq("name", target)
    .maybeSingle();
  if (!existing) {
    await supabase.from(table).insert({ company_id: guard.companyId, name: target, sort_order: 999 });
  }

  await supabase.from(table).delete().eq("company_id", guard.companyId).in("name", sources);

  revalidate(table);
  revalidatePath("/marketing-analytics");
  return { moved: moved?.length ?? 0 };
}

export async function createFieldOption(
  table: OptionTable,
  name: string
): Promise<{ error?: string; id?: string }> {
  const guard = await requireCanEditLeads();
  if ("error" in guard) return guard;

  const trimmed = name.trim();
  if (!trimmed) return { error: "Name is required." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from(table)
    .select("sort_order")
    .eq("company_id", guard.companyId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();
  const nextOrder = ((existing as { sort_order: number } | null)?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from(table)
    .insert({ name: trimmed, sort_order: nextOrder, company_id: guard.companyId })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { error: "That option already exists." };
    return { error: error.message };
  }

  revalidate(table);
  return { id: (data as { id: string }).id };
}

export async function renameFieldOption(
  table: OptionTable,
  id: string,
  name: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

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

  // Keep existing leads pointed at the renamed value (this company's
  // only -- these names aren't unique across companies).
  const column = columnFor(table);
  const patch: Record<string, string> = {};
  patch[column] = trimmed;
  await supabase.from("leads").update(patch).eq(column, current.name).eq("company_id", guard.companyId);

  revalidate(table);
  return {};
}

export async function deleteFieldOption(
  table: OptionTable,
  id: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if ("error" in guard) return guard;

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
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const results = await Promise.all(
    orderedIds.map((id, index) => supabase.from(table).update({ sort_order: index + 1 }).eq("id", id))
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  revalidate(table);
  return {};
}
