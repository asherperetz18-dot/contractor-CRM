import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
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
          .select("dispatcher_id, assigned_to")
          .eq("id", leadId)
          .maybeSingle<{ dispatcher_id: string | null; assigned_to: string | null }>()
      ).data ?? null
    : null;
  const dispatcherId = lead?.dispatcher_id ?? null;

  /**
   * Whose name the customer sees.
   *
   * estimates.assigned_to is stamped when the document is created and
   * never moves again, so reassigning the lead left the proposal naming
   * the previous rep -- a customer reading EST-1032 was told to expect
   * Brendan when Simon is the one turning up.
   *
   * Until it is signed, the document follows the lead: the point of the
   * team block is telling the customer who they will actually meet.
   * Once signed it stops moving, like the terms and the photos -- a
   * contract records who sold the job, and reassigning the lead a year
   * later must not rewrite that.
   */
  const signed = status === "Signed" || status === "Void";
  const repId = (!signed && lead?.assigned_to) || assignedTo;

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
