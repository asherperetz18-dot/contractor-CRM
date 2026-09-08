import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { effectiveEstimateRepId } from "@/lib/data/types";
import type { DocumentTeam } from "@/components/estimate-document";

/**
 * The rep and dispatcher shown on a customer's estimate.
 *
 * Read with the service role because the customer portal has no
 * authenticated staff user at all, and because a dispatcher viewing the
 * preview cannot read a colleague's lead -- yet the document should
 * still name the same people in both places. What it returns is
 * deliberately tiny: a rep's display name and a dispatcher's first name,
 * nothing that could not already be said out loud on the phone.
 *
 * ── Whose name the customer sees ────────────────────────────────────
 *
 * The person who sat at their table. Where a lead has a closer, that is
 * the closer; otherwise it is the assigned rep, who was the one there.
 *
 * This is the customer's view only. Who the document is *counted* for --
 * the rep report, the office list, who gets the "just signed" mail --
 * still resolves from assigned_to and is untouched here. Those answer a
 * different question: whose job is this. This answers who did the
 * customer meet, and the honest answer to that is the name that should
 * be on the paper they read.
 *
 * ── Freezing ────────────────────────────────────────────────────────
 *
 * A signed or void document must never change under the customer, so it
 * stops following the lead. effectiveEstimateRepId already draws that
 * line for the rep, and the closer follows the same one: once signed,
 * the name comes from the contract's own sales team (sales_rep_2, filled
 * at signature by migration 0135), never from a lead that somebody may
 * reassign next month.
 */
export async function getEstimateTeam(
  estimateId: string,
  leadId: string | null,
  assignedTo: string | null,
  /** Frozen once signed. Unsigned documents follow the lead. */
  status?: string
): Promise<DocumentTeam | null> {
  const admin = createAdminClient();

  const lead = leadId
    ? (
        await admin
          .from("leads")
          .select("dispatcher_id, assigned_to, closer_id")
          .eq("id", leadId)
          .maybeSingle<{
            dispatcher_id: string | null;
            assigned_to: string | null;
            closer_id: string | null;
          }>()
      ).data ?? null
    : null;
  const dispatcherId = lead?.dispatcher_id ?? null;

  const frozen = status === "Signed" || status === "Void";

  // The closer, from whichever source is allowed to speak. Frozen
  // documents read the contract's own second seat; live ones follow the
  // lead, exactly as the rep name already does.
  let closerId: string | null = null;
  if (frozen) {
    const { data: contract } = await admin
      .from("estimates")
      .select("sales_rep_2")
      .eq("id", estimateId)
      .maybeSingle<{ sales_rep_2: string | null }>();
    closerId = contract?.sales_rep_2 ?? null;
  } else {
    closerId = lead?.closer_id ?? null;
  }

  // Whose name the customer sees when nobody closed for them. The rule
  // lives in effectiveEstimateRepId so the office list and this copy of
  // the document cannot answer the question differently.
  const assignedRepId = effectiveEstimateRepId({
    status: status ?? "",
    estimateAssignedTo: assignedTo,
    leadAssignedTo: lead?.assigned_to,
  });

  // The closer sat with them; the assigned rep did when there was no
  // closer. Only ever one name on the document either way -- a customer
  // reading two salespeople would reasonably wonder which of them to
  // ring.
  const repId = closerId ?? assignedRepId;

  const ids = [repId, dispatcherId].filter(Boolean) as string[];
  if (ids.length === 0) return null;

  const { data: people } = await admin
    .from("profiles")
    .select("id, name, email")
    .in("id", ids)
    .returns<{ id: string; name: string | null; email: string | null }[]>();
  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  const rep = repId ? byId.get(repId) : null;
  const dispatcher = dispatcherId ? byId.get(dispatcherId) : null;
  // First word only. "Vanessa" is who they spoke to; the surname is
  // company business, not the customer's.
  const dispatcherFirstName = dispatcher?.name?.trim().split(/\s+/)[0] ?? null;

  const repName = rep?.name || rep?.email || null;
  if (!repName && !dispatcherFirstName) return null;
  return { repName, dispatcherFirstName };
}
