"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { canEditDispatch } from "@/lib/data/types";
import {
  buildDuplicatePairs,
  type DupPairContact,
  type DuplicatePair,
  type OversizedDupGroup,
} from "@/lib/duplicate-pairs";

export type { DuplicatePair, DuplicateReason, OversizedDupGroup } from "@/lib/duplicate-pairs";

async function requireCanEditLeads(): Promise<{ error: string } | { companyId: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canEditDispatch(profile))
    return { error: "Office, Sales, Dispatch or Call Center can manage duplicates." };
  return { companyId: profile.company_id };
}

// Detection is computed on demand from leads (matching normalized phone
// or exact-lowercase email) rather than stored, so it's always current.
// Only lead_duplicate_dismissals -- which pairs a user has already ruled
// out -- is persisted. The scan is slim (never notes, never full rows),
// pairing runs in buildDuplicatePairs with its safety rails (a junk
// number shared by hundreds of imports reports as a cluster instead of
// exploding into pairs, and the list is capped) -- the uncapped version
// froze the browser the day the 73k import landed. See its tests.
const MAX_PAIR_GROUP = 8;
const MAX_PAIRS = 200;

export async function findDuplicateLeads(): Promise<{
  error?: string;
  pairs?: DuplicatePair[];
  totalPairs?: number;
  oversized?: OversizedDupGroup[];
}> {
  const guard = await requireCanEditLeads();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const [rows, { data: dismissals }] = await Promise.all([
    selectAll<DupPairContact>((rangeFrom, rangeTo) =>
      supabase
        .from("leads")
        .select("id, contact_type, company_name, first_name, last_name, phone, email, source, stage, created_at")
        .eq("company_id", guard.companyId)
        // Ordered so the pager's pages can't overlap or skip.
        .order("created_at", { ascending: false })
        .range(rangeFrom, rangeTo)
    ),
    supabase
      .from("lead_duplicate_dismissals")
      .select("lead_id_a, lead_id_b")
      .eq("company_id", guard.companyId),
  ]);
  const dismissedPairs = new Set(
    ((dismissals ?? []) as { lead_id_a: string; lead_id_b: string }[]).map(
      (d) => `${d.lead_id_a}:${d.lead_id_b}`
    )
  );

  const result = buildDuplicatePairs(rows, dismissedPairs, {
    maxGroupSize: MAX_PAIR_GROUP,
    maxPairs: MAX_PAIRS,
  });
  return { pairs: result.pairs, totalPairs: result.totalPairs, oversized: result.oversized };
}

export type MergePreviewSide = {
  leadId: string;
  notes: { id: string; body: string; created_at: string }[];
  files: { id: string; file_name: string; file_url: string; created_at: string }[];
  calls: {
    id: string;
    direction: string;
    status: string;
    duration_seconds: number;
    disposition: string;
    created_at: string;
  }[];
  texts: { id: string; direction: string; body: string; created_at: string }[];
  events: { id: string; title: string | null; date: string; time: string | null; event_type: string; status: string }[];
};

// Full record of what's actually attached to each contact -- shown before
// a merge commits, since reassigning-then-deleting is irreversible and a
// generic "this will move some stuff over" confirmation isn't enough to
// judge whether that's safe.
export async function getMergePreview(
  leadIdA: string,
  leadIdB: string
): Promise<{ error?: string; sides?: Record<string, MergePreviewSide> }> {
  const guard = await requireCanEditLeads();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: bothLeads } = await supabase
    .from("leads")
    .select("id")
    .eq("company_id", guard.companyId)
    .in("id", [leadIdA, leadIdB]);
  if ((bothLeads?.length ?? 0) !== 2) return { error: "Contact not found." };

  async function sideFor(leadId: string): Promise<MergePreviewSide> {
    const [{ data: notes }, { data: files }, { data: calls }, { data: texts }, { data: events }] =
      await Promise.all([
        supabase
          .from("lead_notes")
          .select("id, body, created_at")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false }),
        supabase
          .from("lead_files")
          .select("id, file_name, file_url, created_at")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false }),
        supabase
          .from("call_logs")
          .select("id, direction, status, duration_seconds, disposition, created_at")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false }),
        supabase
          .from("sms_messages")
          .select("id, direction, body, created_at")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false }),
        supabase
          .from("events")
          .select("id, title, date, time, event_type, status")
          .eq("lead_id", leadId)
          .order("date", { ascending: false }),
      ]);
    return {
      leadId,
      notes: (notes as MergePreviewSide["notes"]) ?? [],
      files: (files as MergePreviewSide["files"]) ?? [],
      calls: (calls as MergePreviewSide["calls"]) ?? [],
      texts: (texts as MergePreviewSide["texts"]) ?? [],
      events: (events as MergePreviewSide["events"]) ?? [],
    };
  }

  const [sideA, sideB] = await Promise.all([sideFor(leadIdA), sideFor(leadIdB)]);
  return { sides: { [leadIdA]: sideA, [leadIdB]: sideB } };
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
