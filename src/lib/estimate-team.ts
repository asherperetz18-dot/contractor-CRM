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
  assignedTo: string | null
): Promise<DocumentTeam | null> {
  const admin = createAdminClient();

  const dispatcherId = leadId
    ? (
        await admin
          .from("leads")
          .select("dispatcher_id")
          .eq("id", leadId)
          .maybeSingle<{ dispatcher_id: string | null }>()
      ).data?.dispatcher_id ?? null
    : null;

  const ids = [assignedTo, dispatcherId].filter(Boolean) as string[];
  if (ids.length === 0) return null;

  const { data: people } = await admin
    .from("profiles")
    .select("id, name, email")
    .in("id", ids)
    .returns<{ id: string; name: string | null; email: string | null }[]>();
  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  const rep = assignedTo ? byId.get(assignedTo) : null;
  const dispatcher = dispatcherId ? byId.get(dispatcherId) : null;
  // First word only. "Vanessa" is who they spoke to; the surname is
  // company business, not the customer's.
  const dispatcherFirstName = dispatcher?.name?.trim().split(/\s+/)[0] ?? null;

  const repName = rep?.name || rep?.email || null;
  if (!repName && !dispatcherFirstName) return null;
  return { repName, dispatcherFirstName };
}
