import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AT_OR_PAST_PROPOSAL_KEYS, type StageKey } from "./stage-keys";

/**
 * Moving a lead's pipeline stage when the estimate says something the
 * stage does not.
 *
 * The stage is maintained by hand and routinely goes stale: every sent or
 * signed estimate in this account was contradicted by its lead's stage,
 * including a signed $5,400 contract on a lead still reading "Appointment
 * Scheduled" and an $18,000 proposal on a lead marked "Lost". The estimate
 * knows on its own, so it is allowed to move the stage.
 *
 * Stage names are per-company and editable, so every move goes by the
 * stage's tag (DECISIONS #120): the lead lands in this company's stage
 * with that tag, under whatever name it has. A company that deleted the
 * target stage gets a no-op rather than a stage its board cannot render.
 */

export type StageMove = { moved: boolean; from?: string; to?: string };

async function moveTo(
  admin: SupabaseClient,
  leadId: string,
  companyId: string,
  target: StageKey,
  allowed: (currentKey: string | null) => boolean
): Promise<StageMove> {
  const { data: lead } = await admin
    .from("leads")
    .select("id, stage, stage_key")
    .eq("id", leadId)
    .eq("company_id", companyId)
    .maybeSingle<{ id: string; stage: string; stage_key: string | null }>();
  if (!lead) return { moved: false };

  const current = lead.stage || "";
  if (lead.stage_key === target || !allowed(lead.stage_key)) return { moved: false, from: current };

  // The database resolves the tag to this company's stage (0195) and
  // leaves the lead where it was if there is none -- so the answer, not
  // the absence of an error, says whether it moved.
  const { data: updated } = await admin
    .from("leads")
    .update({ stage_key: target })
    .eq("id", leadId)
    .eq("company_id", companyId)
    .select("stage, stage_key");
  const after = (updated?.[0] ?? null) as { stage: string; stage_key: string | null } | null;
  const moved = after?.stage_key === target;
  return { moved, from: current, to: moved ? after.stage : undefined };
}

/**
 * A proposal is out, so the lead is at Proposal Sent.
 *
 * Revives a lead somebody had written off -- sending an estimate
 * contradicts "Lost". DNC is left alone: pulling a do-not-contact lead
 * back into the active pipeline invites more outreach to someone who
 * asked for none.
 */
export function advanceStageOnEstimateSent(
  admin: SupabaseClient,
  leadId: string,
  companyId: string
): Promise<StageMove> {
  return moveTo(
    admin,
    leadId,
    companyId,
    "proposal_sent",
    (key) => key !== "dnc" && !(AT_OR_PAST_PROPOSAL_KEYS as readonly (string | null)[]).includes(key)
  );
}

/** Signed is won, from wherever the lead happened to be sitting. */
export function advanceStageOnEstimateSigned(
  admin: SupabaseClient,
  leadId: string,
  companyId: string
): Promise<StageMove> {
  return moveTo(admin, leadId, companyId, "won", () => true);
}

/**
 * The customer has applied for financing, or been approved (DECISIONS
 * #162): the lead is at Pending Finance. Not from further along (Close
 * to Sale, Won) and never a do-not-contact lead -- the rule is
 * movesToPendingFinance's, checked again here against the stage as it
 * is now.
 */
export function advanceStageOnFinancing(
  admin: SupabaseClient,
  leadId: string,
  companyId: string
): Promise<StageMove> {
  return moveTo(
    admin,
    leadId,
    companyId,
    "pending_finance",
    (key) => !["pending_finance", "close_to_sale", "won", "dnc"].includes(key ?? "")
  );
}
