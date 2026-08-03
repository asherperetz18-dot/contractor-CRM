"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole, leadDisplayName, type Lead, type Profile } from "@/lib/data/types";
import {
  AI_ACTION_TYPES,
  MAX_TARGETS_PER_PROPOSAL,
  type AiActionType,
  type ProposalRow,
} from "@/lib/data/ai-proposals";

function canApprove(profile: Pick<Profile, "roles"> | null) {
  return !!profile && (profile.roles.includes("Office") || isAdminRole(profile));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Human-readable preview of exactly which contacts a proposal would touch.
 * Resolved fresh at render time (not stored), so it reflects the data as it
 * is now rather than as it was when the AI suggested the change.
 */
export async function describeProposalTargets(
  proposalId: string
): Promise<{ names: string[]; missing: number; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { names: [], missing: 0, error: "Not signed in." };

  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_action_proposals")
    .select("params, company_id")
    .eq("id", proposalId)
    .eq("company_id", profile.company_id)
    .maybeSingle();
  const row = data as { params: Record<string, unknown> } | null;
  if (!row) return { names: [], missing: 0, error: "Proposal not found." };

  const ids = asStringArray(row.params.lead_ids);
  if (ids.length === 0) return { names: [], missing: 0 };

  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .eq("company_id", profile.company_id)
    .in("id", ids);
  const rows = (leads as Lead[]) ?? [];
  return {
    names: rows.map((l) => leadDisplayName(l)),
    missing: ids.length - rows.length,
  };
}

export async function listProposals(limit = 20): Promise<ProposalRow[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_action_proposals")
    .select("id, action_type, params, summary, target_count, status, result, error, created_at, decided_at")
    .eq("company_id", profile.company_id)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as ProposalRow[]) ?? [];
}

export async function rejectProposal(proposalId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!canApprove(profile)) return { error: "You don't have permission to do that." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("ai_action_proposals")
    .update({
      status: "rejected",
      decided_by: profile!.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", proposalId)
    .eq("company_id", profile!.company_id)
    .eq("status", "pending");
  if (error) return { error: error.message };
  revalidatePath("/");
  return {};
}

/**
 * Applies a previously proposed change after a human approves it.
 *
 * Everything is re-checked here rather than trusted from the stored
 * proposal: the caller's permission, the company scope of every target
 * row, the target cap, and that the action type is one we actually
 * support. The AI's output is treated as an untrusted suggestion.
 */
export async function applyProposal(
  proposalId: string
): Promise<{ error?: string; changed?: number; skipped?: number }> {
  const profile = await getCurrentProfile();
  if (!canApprove(profile)) return { error: "You don't have permission to do that." };

  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_action_proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("company_id", profile!.company_id)
    .maybeSingle();
  const proposal = data as {
    id: string;
    action_type: string;
    params: Record<string, unknown>;
    status: string;
  } | null;

  if (!proposal) return { error: "Proposal not found." };
  if (proposal.status !== "pending") return { error: "This suggestion was already handled." };
  if (!AI_ACTION_TYPES.includes(proposal.action_type as AiActionType)) {
    return { error: "That action type isn't supported." };
  }

  const companyId = profile!.company_id;
  const params = proposal.params;
  let changed = 0;
  let skipped = 0;
  let failure: string | null = null;

  // Only ids that really belong to this company survive -- a hallucinated
  // or cross-tenant id simply drops out and is counted as skipped.
  async function ownedLeadIds(): Promise<string[]> {
    const requested = asStringArray(params.lead_ids);
    if (requested.length === 0) return [];
    const { data: rows } = await supabase
      .from("leads")
      .select("id")
      .eq("company_id", companyId)
      .in("id", requested.slice(0, MAX_TARGETS_PER_PROPOSAL));
    const owned = ((rows as { id: string }[]) ?? []).map((r) => r.id);
    skipped = requested.length - owned.length;
    return owned;
  }

  try {
    if (proposal.action_type === "move_lead_stage") {
      const stage = typeof params.stage === "string" ? params.stage : "";
      const { data: stageRow } = await supabase
        .from("pipeline_stages")
        .select("name")
        .eq("company_id", companyId)
        .eq("name", stage)
        .maybeSingle();
      if (!stageRow) {
        failure = `"${stage}" isn't one of your pipeline stages.`;
      } else {
        const ids = await ownedLeadIds();
        if (ids.length) {
          const { error } = await supabase
            .from("leads")
            .update({ stage })
            .eq("company_id", companyId)
            .in("id", ids);
          if (error) failure = error.message;
          else changed = ids.length;
        }
      }
    } else if (proposal.action_type === "assign_leads") {
      const assignedTo = typeof params.assigned_to === "string" ? params.assigned_to : "";
      const { data: member } = await supabase
        .from("company_members")
        .select("profile_id")
        .eq("company_id", companyId)
        .eq("profile_id", assignedTo)
        .maybeSingle();
      if (!member) {
        failure = "That rep isn't a member of this company.";
      } else {
        const ids = await ownedLeadIds();
        if (ids.length) {
          const { error } = await supabase
            .from("leads")
            .update({ assigned_to: assignedTo })
            .eq("company_id", companyId)
            .in("id", ids);
          if (error) failure = error.message;
          else changed = ids.length;
        }
      }
    } else if (proposal.action_type === "create_tasks") {
      const title = typeof params.title === "string" ? params.title.trim() : "";
      const dueDate =
        typeof params.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.due_date)
          ? params.due_date
          : new Date().toISOString().slice(0, 10);
      if (!title) {
        failure = "That task has no title.";
      } else {
        const ids = await ownedLeadIds();
        if (ids.length) {
          const { error } = await supabase.from("lead_tasks").insert(
            ids.map((leadId) => ({
              lead_id: leadId,
              title,
              due_date: dueDate,
              company_id: companyId,
              created_by: profile!.id,
            }))
          );
          if (error) failure = error.message;
          else changed = ids.length;
        }
      }
    }
  } catch (e) {
    failure = e instanceof Error ? e.message : "Something went wrong applying that change.";
  }

  await supabase
    .from("ai_action_proposals")
    .update({
      status: failure ? "failed" : "applied",
      decided_by: profile!.id,
      decided_at: new Date().toISOString(),
      result: failure ? null : { changed, skipped },
      error: failure,
    })
    .eq("id", proposalId);

  if (failure) return { error: failure };

  revalidatePath("/pipeline");
  revalidatePath("/contacts");
  revalidatePath("/");
  return { changed, skipped };
}
