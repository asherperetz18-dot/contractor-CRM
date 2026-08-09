import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

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
 * Stage names are per-company rows in pipeline_stages and are editable, so
 * every move is looked up in that company's own pipeline first. A company
 * that renamed or deleted the target stage gets a no-op rather than a
 * stage string its board cannot render.
 */

const PROPOSAL_SENT = "Proposal Sent";
const WON = "Won";

// Already at or past "proposal sent" in the sales sequence. Sending a
// revised estimate to someone in Pending Finance must not drag them
// backwards -- sort_order cannot decide this, because Lost and DNC are
// terminal states parked at the end of the list rather than late stages.
const AT_OR_PAST_PROPOSAL = new Set([
  "proposal sent",
  "pending finance",
  "close to sale",
  "won",
]);

export type StageMove = { moved: boolean; from?: string; to?: string };

async function moveTo(
  admin: SupabaseClient,
  leadId: string,
  companyId: string,
  targetName: string,
  allowed: (currentStage: string) => boolean
): Promise<StageMove> {
  const { data: lead } = await admin
    .from("leads")
    .select("id, stage")
    .eq("id", leadId)
    .maybeSingle<{ id: string; stage: string }>();
  if (!lead) return { moved: false };

  const current = lead.stage || "";
  if (!allowed(current)) return { moved: false, from: current };

  const { data: stage } = await admin
    .from("pipeline_stages")
    .select("name")
    .eq("company_id", companyId)
    .ilike("name", targetName)
    .maybeSingle<{ name: string }>();
  if (!stage) return { moved: false, from: current };
  if (stage.name === current) return { moved: false, from: current };

  // Row count checked rather than trusting the absence of an error: a
  // blocked update matches zero rows and raises nothing.
  const { data: updated } = await admin
    .from("leads")
    .update({ stage: stage.name })
    .eq("id", leadId)
    .select("id");

  return { moved: !!updated?.length, from: current, to: stage.name };
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
  return moveTo(admin, leadId, companyId, PROPOSAL_SENT, (s) => {
    const cur = s.toLowerCase();
    return cur !== "dnc" && !AT_OR_PAST_PROPOSAL.has(cur);
  });
}

/** Signed is won, from wherever the lead happened to be sitting. */
export function advanceStageOnEstimateSigned(
  admin: SupabaseClient,
  leadId: string,
  companyId: string
): Promise<StageMove> {
  return moveTo(admin, leadId, companyId, WON, (s) => s.toLowerCase() !== "won");
}
