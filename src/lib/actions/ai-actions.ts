"use server";

import { companyToday } from "@/lib/data/company-today";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canEditChecklists,
  isAdminRole,
  leadDisplayName,
  type Lead,
  type Profile,
} from "@/lib/data/types";
import {
  AI_ACTION_TYPES,
  MAX_TARGETS_PER_PROPOSAL,
  PROPOSAL_STALE_DAYS,
  parseChecklistAddParams,
  parseChecklistCheckParams,
  proposalIsStale,
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
  if (ids.length > 0) {
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

  // Check-off proposals name their steps, resolved fresh so a step
  // someone already completed or removed shows up as missing.
  const itemIds = asStringArray(row.params.item_ids);
  if (itemIds.length > 0) {
    const { data: items } = await supabase
      .from("project_checklist_items")
      .select("label")
      .eq("company_id", profile.company_id)
      .is("completed_at", null)
      .in("id", itemIds);
    const labels = ((items as { label: string }[]) ?? []).map((i) => i.label);
    return { names: labels, missing: itemIds.length - labels.length };
  }

  // Add proposals carry their steps in the params; the project's doc
  // number is looked up so the card says which job gets them.
  const addParsed = parseChecklistAddParams(row.params);
  if (addParsed) {
    const { data: estimate } = await supabase
      .from("estimates")
      .select("doc_number")
      .eq("company_id", profile.company_id)
      .eq("id", addParsed.estimateId)
      .maybeSingle();
    const doc = (estimate as { doc_number: string } | null)?.doc_number;
    return {
      names: addParsed.items.map((it) => (doc ? `${doc}: ${it.label}` : it.label)),
      missing: doc ? 0 : 1,
    };
  }

  return { names: [], missing: 0 };
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
    created_at: string;
  } | null;

  if (!proposal) return { error: "Proposal not found." };
  if (proposal.status !== "pending") return { error: "This suggestion was already handled." };
  // Enforced server-side, not just hidden in the UI.
  if (proposalIsStale(proposal.created_at)) {
    return {
      error: `This suggestion is more than ${PROPOSAL_STALE_DAYS} days old. Ask the assistant again so it can work from current data.`,
    };
  }
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
          : await companyToday();
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
              // Same rule as createLeadTask: a task always has an
              // assignee, and an AI proposal is accepted by the person
              // it lands on.
              assigned_to: profile!.id,
            }))
          );
          if (error) failure = error.message;
          else changed = ids.length;
        }
      }
    } else if (proposal.action_type === "add_checklist_items") {
      const parsed = parseChecklistAddParams(params);
      if (!parsed) {
        failure = "That suggestion is malformed.";
      } else if (!canEditChecklists(profile)) {
        // The approver is Office/Admin today, but the page's own gate is
        // restated here so a future approver role can't slip past it.
        failure = "Only Office, Admin or Production users can change the list.";
      } else {
        const { data: estimate } = await supabase
          .from("estimates")
          .select("id")
          .eq("company_id", companyId)
          .eq("id", parsed.estimateId)
          .maybeSingle();
        if (!estimate) {
          failure = "That project isn't in this company.";
        } else {
          // Same dedupe-and-append discipline as adding a step by hand.
          const { data: existing } = await supabase
            .from("project_checklist_items")
            .select("label, sort_order")
            .eq("estimate_id", parsed.estimateId)
            .returns<{ label: string; sort_order: number }[]>();
          const have = new Set((existing ?? []).map((i) => i.label.trim().toLowerCase()));
          let sort = Math.max(-1, ...(existing ?? []).map((i) => i.sort_order)) + 1;
          const rows = parsed.items
            .filter((it) => !have.has(it.label.trim().toLowerCase()))
            .map((it) => ({
              company_id: companyId,
              estimate_id: parsed.estimateId,
              label: it.label,
              sort_order: sort++,
              due_date: it.dueDate,
            }));
          skipped = parsed.items.length - rows.length;
          if (rows.length) {
            const { error } = await supabase.from("project_checklist_items").insert(rows);
            if (error) failure = error.message;
            else changed = rows.length;
          }
        }
      }
    } else if (proposal.action_type === "check_checklist_items") {
      const parsed = parseChecklistCheckParams(params);
      if (!parsed) {
        failure = "That suggestion is malformed.";
      } else {
        // Only open steps that really belong to this company survive; a
        // hallucinated id or an already-done step drops out as skipped.
        const { data: rows } = await supabase
          .from("project_checklist_items")
          .select("id")
          .eq("company_id", companyId)
          .is("completed_at", null)
          .in("id", parsed.itemIds);
        const owned = ((rows as { id: string }[]) ?? []).map((r) => r.id);
        skipped = parsed.itemIds.length - owned.length;
        if (owned.length) {
          const { error } = await supabase
            .from("project_checklist_items")
            .update({ completed_at: new Date().toISOString(), completed_by: profile!.id })
            .eq("company_id", companyId)
            .in("id", owned);
          if (error) failure = error.message;
          else changed = owned.length;
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
  revalidatePath("/projects");
  revalidatePath("/");
  return { changed, skipped };
}
