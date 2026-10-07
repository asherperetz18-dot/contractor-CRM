import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { lendersFromProfile, lendersFromRows, type CompanyLender, type LenderRow } from "@/lib/financing";

type Client = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

/**
 * The company's lenders, in the order they're tried (DECISIONS #170): the
 * list in financing_lenders, or -- before 0220 has run -- the one lender
 * in company_profile (0214) with its fee (0219), as before. `ready`: 0220
 * has run, so the list can be added to.
 */
export async function companyLenders(
  client: Client,
  companyId: string
): Promise<{ ready: boolean; lenders: CompanyLender[] }> {
  const { data, error } = await client
    .from("financing_lenders")
    .select("*")
    .eq("company_id", companyId)
    .order("sort_order")
    .returns<LenderRow[]>();
  if (!error) return { ready: true, lenders: lendersFromRows(data ?? []) };
  // Every column, so a database without 0219's fee still reads.
  const { data: profile } = await client
    .from("company_profile")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle<{ financing_provider?: string | null; financing_url?: string | null; financing_fee_bp?: number | null }>();
  return { ready: false, lenders: lendersFromProfile(profile) };
}
