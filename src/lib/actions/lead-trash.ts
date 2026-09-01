"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { restoreSnapshot, type LeadTrashPayload } from "@/lib/lead-trash";
import { canDeleteLeads } from "@/lib/data/types";

export type TrashEntry = {
  id: string;
  lead_id: string;
  display_name: string | null;
  deleted_by_name: string | null;
  deleted_at: string;
  /** "2 estimates · 5 notes · 3 photos" — what a restore brings back. */
  summary: string;
};

function summarize(payload: LeadTrashPayload): string {
  const c = payload.children ?? {};
  const n = (t: string) => c[t]?.length ?? 0;
  const parts: string[] = [];
  const label = (count: number, one: string, many: string) =>
    count > 0 && parts.push(`${count} ${count === 1 ? one : many}`);
  label(n("estimates"), "estimate", "estimates");
  label(payload.relinks?.events?.length ?? 0, "appointment", "appointments");
  label(n("lead_notes"), "note", "notes");
  label(n("lead_tasks"), "task", "tasks");
  label(n("lead_files"), "file", "files");
  label(payload.relinks?.sms_messages?.length ?? 0, "text", "texts");
  return parts.join(" · ") || "contact details only";
}

export async function listLeadTrash(): Promise<{ error?: string; entries?: TrashEntry[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canDeleteLeads(profile)) return { error: "Office or Admin only." };

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("lead_trash")
    .select("id, lead_id, display_name, deleted_by, deleted_at, payload")
    .eq("company_id", profile.company_id)
    .order("deleted_at", { ascending: false });
  // Only the deleters actually named by these rows -- the admin client
  // answers exactly what it is asked, and it was being asked for every
  // profile on the platform to label a handful of ids.
  const deleterIds = [
    ...new Set(((rows as { deleted_by: string | null }[]) ?? []).map((r) => r.deleted_by).filter(Boolean)),
  ] as string[];
  const { data: profs } = deleterIds.length
    ? await admin.from("profiles").select("id, name").in("id", deleterIds)
    : { data: [] };
  const nameById = new Map(
    ((profs as { id: string; name: string | null }[]) ?? []).map((p) => [p.id, p.name])
  );

  const entries: TrashEntry[] = (
    (rows as {
      id: string;
      lead_id: string;
      display_name: string | null;
      deleted_by: string | null;
      deleted_at: string;
      payload: LeadTrashPayload;
    }[]) ?? []
  ).map((r) => ({
    id: r.id,
    lead_id: r.lead_id,
    display_name: r.display_name,
    deleted_by_name: r.deleted_by ? (nameById.get(r.deleted_by) ?? null) : null,
    deleted_at: r.deleted_at,
    summary: summarize(r.payload),
  }));
  return { entries };
}

/**
 * Puts a deleted contact back, with everything the snapshot holds and
 * every orphaned link re-pointed. The trash row is only removed once
 * the contact row itself is back, so a failed restore can be retried.
 */
export async function restoreLeadFromTrash(
  trashId: string
): Promise<{ error?: string; issues?: string[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canDeleteLeads(profile)) return { error: "Office or Admin only." };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("lead_trash")
    .select("id, lead_id, payload")
    .eq("id", trashId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; lead_id: string; payload: LeadTrashPayload }>();
  if (!row) return { error: "That trash entry no longer exists." };

  const { data: existing } = await admin
    .from("leads")
    .select("id")
    .eq("id", row.lead_id)
    .maybeSingle();
  if (existing) {
    return { error: "A contact with this id already exists — it may have been restored already." };
  }

  const result = await restoreSnapshot(admin, row.payload);
  if (result.error) return { error: result.error };

  await admin.from("lead_trash").delete().eq("id", row.id);

  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  revalidatePath("/settings/trash");
  return { issues: result.issues };
}

/** Empties one entry for good — the only truly unrecoverable delete left. */
export async function purgeTrashEntry(trashId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canDeleteLeads(profile)) return { error: "Office or Admin only." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("lead_trash")
    .delete()
    .eq("id", trashId)
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };
  revalidatePath("/settings/trash");
  return {};
}
