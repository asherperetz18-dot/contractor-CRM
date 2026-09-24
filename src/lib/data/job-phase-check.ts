import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Server-side helper, deliberately not in a "use server" file: exported
 * from one it would become an action anyone could call with any company
 * id and use to probe for other tenants' phases.
 */

/**
 * Is this payment phase on one of this job's documents? The write policy
 * checks only the cost's company, so a phase id from another job -- or
 * another company -- would otherwise file the cost against a contract it
 * has nothing to do with.
 */
export async function phaseIsOnJob(companyId: string, leadId: string, phaseId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: phase } = await admin
    .from("estimate_payments")
    .select("estimate_id")
    .eq("id", phaseId)
    .maybeSingle<{ estimate_id: string }>();
  if (!phase) return false;
  const { data: doc } = await admin
    .from("estimates")
    .select("id")
    .eq("id", phase.estimate_id)
    .eq("lead_id", leadId)
    .eq("company_id", companyId)
    .maybeSingle();
  return !!doc;
}
