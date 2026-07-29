"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { canEditDispatch, normalizePhone, type Lead } from "@/lib/data/types";

export type DuplicateReason = "phone" | "email";

export type DuplicatePair = {
  leadA: Lead;
  leadB: Lead;
  reasons: DuplicateReason[];
};

async function requireCanEditLeads(): Promise<{ error: string } | { companyId: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canEditDispatch(profile)) return { error: "Only Office or Sales users can manage duplicates." };
  return { companyId: profile.company_id };
}

// Detection is computed on demand from leads (matching normalized phone
// or exact-lowercase email) rather than stored, so it's always current.
// Only lead_duplicate_dismissals -- which pairs a user has already ruled
// out -- is persisted.
export async function findDuplicateLeads(): Promise<{ error?: string; pairs?: DuplicatePair[] }> {
  const guard = await requireCanEditLeads();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const [{ data: leads }, { data: dismissals }] = await Promise.all([
    supabase.from("leads").select("*").eq("company_id", guard.companyId),
    supabase
      .from("lead_duplicate_dismissals")
      .select("lead_id_a, lead_id_b")
      .eq("company_id", guard.companyId),
  ]);
  const allLeads = (leads as Lead[]) ?? [];
  const dismissedPairs = new Set(
    ((dismissals ?? []) as { lead_id_a: string; lead_id_b: string }[]).map(
      (d) => `${d.lead_id_a}:${d.lead_id_b}`
    )
  );

  const byPhone = new Map<string, Lead[]>();
  const byEmail = new Map<string, Lead[]>();
  for (const lead of allLeads) {
    const phone = lead.phone ? normalizePhone(lead.phone) : "";
    if (phone.length >= 7) {
      if (!byPhone.has(phone)) byPhone.set(phone, []);
      byPhone.get(phone)!.push(lead);
    }
    const email = lead.email?.trim().toLowerCase() ?? "";
    if (email) {
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email)!.push(lead);
    }
  }

  const pairReasons = new Map<
    string,
    { leadA: Lead; leadB: Lead; reasons: Set<DuplicateReason> }
  >();
  function addGroups(groups: Map<string, Lead[]>, reason: DuplicateReason) {
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const [a, b] = group[i].id < group[j].id ? [group[i], group[j]] : [group[j], group[i]];
          const key = `${a.id}:${b.id}`;
          if (dismissedPairs.has(key)) continue;
          const entry = pairReasons.get(key) ?? { leadA: a, leadB: b, reasons: new Set<DuplicateReason>() };
          entry.reasons.add(reason);
          pairReasons.set(key, entry);
        }
      }
    }
  }
  addGroups(byPhone, "phone");
  addGroups(byEmail, "email");

  const pairs = [...pairReasons.values()]
    .map((p) => ({ leadA: p.leadA, leadB: p.leadB, reasons: [...p.reasons] }))
    .sort((a, b) => b.reasons.length - a.reasons.length);

  return { pairs };
}

export async function dismissDuplicatePair(
  leadIdA: string,
  leadIdB: string
): Promise<{ error?: string }> {
  const guard = await requireCanEditLeads();
  if ("error" in guard) return guard;

  const profile = await getCurrentProfile();
  const [a, b] = leadIdA < leadIdB ? [leadIdA, leadIdB] : [leadIdB, leadIdA];

  const supabase = await createClient();
  const { error } = await supabase.from("lead_duplicate_dismissals").insert({
    company_id: guard.companyId,
    lead_id_a: a,
    lead_id_b: b,
    dismissed_by: profile?.id ?? null,
  });
  if (error && error.code !== "23505") return { error: error.message };
  return {};
}

// Reassigns every child record from the secondary lead to the primary
// lead, then deletes the secondary. Runs on the admin client for the
// mutation itself (after verifying the caller's role and that both
// leads belong to their company via the session client) so a Sales-only
// user's per-row RLS scoping on child tables (events/lead_tasks/etc.
// only "theirs") can't leave a merge half-applied.
export async function mergeLeads(
  primaryId: string,
  secondaryId: string
): Promise<{ error?: string }> {
  const guard = await requireCanEditLeads();
  if ("error" in guard) return guard;
  if (primaryId === secondaryId) return { error: "Can't merge a contact with itself." };

  const supabase = await createClient();
  const { data: bothLeads } = await supabase
    .from("leads")
    .select("id")
    .eq("company_id", guard.companyId)
    .in("id", [primaryId, secondaryId]);
  if ((bothLeads?.length ?? 0) !== 2) return { error: "Contact not found." };

  const admin = createAdminClient();

  // setter_contacts has unique(setter_id, lead_id) -- drop secondary's
  // rows that would collide with an existing primary assignment before
  // reassigning the rest.
  const [{ data: primarySetters }, { data: secondarySetters }] = await Promise.all([
    admin.from("setter_contacts").select("id, setter_id").eq("lead_id", primaryId),
    admin.from("setter_contacts").select("id, setter_id").eq("lead_id", secondaryId),
  ]);
  const primarySetterIds = new Set(
    ((primarySetters ?? []) as { setter_id: string }[]).map((s) => s.setter_id)
  );
  const collidingIds = ((secondarySetters ?? []) as { id: string; setter_id: string }[])
    .filter((s) => primarySetterIds.has(s.setter_id))
    .map((s) => s.id);
  if (collidingIds.length > 0) {
    await admin.from("setter_contacts").delete().in("id", collidingIds);
  }

  const results = await Promise.all([
    admin.from("events").update({ lead_id: primaryId }).eq("lead_id", secondaryId),
    admin.from("jobs").update({ lead_id: primaryId }).eq("lead_id", secondaryId),
    admin.from("documents").update({ contact_id: primaryId }).eq("contact_id", secondaryId),
    admin.from("lead_tasks").update({ lead_id: primaryId }).eq("lead_id", secondaryId),
    admin.from("lead_notes").update({ lead_id: primaryId }).eq("lead_id", secondaryId),
    admin.from("lead_files").update({ lead_id: primaryId }).eq("lead_id", secondaryId),
    admin.from("call_logs").update({ lead_id: primaryId }).eq("lead_id", secondaryId),
    admin.from("sms_messages").update({ lead_id: primaryId }).eq("lead_id", secondaryId),
    admin.from("setter_contacts").update({ lead_id: primaryId }).eq("lead_id", secondaryId),
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  const { data: lists } = await admin
    .from("dial_lists")
    .select("id, lead_ids")
    .contains("lead_ids", [secondaryId]);
  for (const list of (lists ?? []) as { id: string; lead_ids: string[] }[]) {
    const nextIds = [...new Set(list.lead_ids.map((id) => (id === secondaryId ? primaryId : id)))];
    await admin.from("dial_lists").update({ lead_ids: nextIds }).eq("id", list.id);
  }

  const { error: deleteError } = await admin.from("leads").delete().eq("id", secondaryId);
  if (deleteError) return { error: deleteError.message };

  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  revalidatePath("/calendar");
  revalidatePath("/schedule");
  revalidatePath("/production");
  return {};
}
