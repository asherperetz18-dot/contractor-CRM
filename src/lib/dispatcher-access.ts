import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/data/types";

/**
 * Whether this dispatcher is entitled to write to a lead.
 *
 * A dispatcher owns a lead from arrival until it sells and is paid on
 * the sale, so they must be able to claim it, note what happened and set
 * follow-ups. The row-level policies for those three writes still
 * require Office or Sales, which leaves a dispatcher unable to work the
 * lead they are being paid for.
 *
 * Rather than wait on the policy change, the callers check this and then
 * write with the service role -- the same shape already used for
 * payments, progress billing and SMS, where the rule lives in the action
 * and the write bypasses RLS. It is a weaker guarantee than a policy and
 * is meant to be belt to the policy's braces, not a replacement: reads
 * are still governed by RLS, so a dispatcher can only ever act on a lead
 * the database was willing to show them.
 */
export async function dispatcherMayWriteToLead(
  profile: Pick<Profile, "id" | "roles">,
  leadId: string,
  companyId: string
): Promise<boolean> {
  if (!profile.roles?.includes("Dispatch")) return false;

  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select("id, dispatcher_id")
    .eq("id", leadId)
    .eq("company_id", companyId)
    .maybeSingle<{ id: string; dispatcher_id: string | null }>();
  if (!data) return false;

  // Theirs, or nobody's. Never a colleague's -- taking someone else's
  // lead takes the commission that goes with it.
  return data.dispatcher_id === profile.id || data.dispatcher_id === null;
}
