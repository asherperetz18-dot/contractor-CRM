import type { SupabaseClient } from "@supabase/supabase-js";

export type ParentContract = { doc_number: string; total_cents: number; signed_at: string | null };

/**
 * The contract a change order, certificate or invoice belongs to, as its
 * customer's portal shows it. Read with the service role: a portal
 * customer has no CRM login, so the staff lookup (getParentContract)
 * comes back empty under row-level security -- and the change order lost
 * its "To contract EST-1112" line and the revised total. Scoped to the
 * viewer's own lead, because with the service role that check is the
 * boundary.
 */
export async function portalParentContract(
  admin: SupabaseClient,
  parentId: string | null,
  leadId: string
): Promise<ParentContract | null> {
  if (!parentId) return null;
  const { data } = await admin
    .from("estimates")
    .select("doc_number, total_cents, signed_at")
    .eq("id", parentId)
    .eq("lead_id", leadId)
    .maybeSingle<ParentContract>();
  return data ?? null;
}
