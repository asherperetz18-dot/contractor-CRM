import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/data/select-all";
import {
  SETUP_PROFILE_COLUMNS,
  setupFactsFromRow,
  setupItems,
  setupSummary,
  type SetupFacts,
  type SetupProfileRow,
  type SetupSummary,
} from "@/lib/setup-checklist";

/**
 * The setup checklist's facts (DECISIONS #136), read on the server
 * through the service-role client: of each saved secret, only whether it
 * is there goes any further. That bypasses row-level security, so
 * `companyId` must be one the caller belongs to -- in practice
 * `profile.company_id`. Never an id from the browser.
 */
export async function getSetupFacts(companyId: string): Promise<SetupFacts | null> {
  const admin = createAdminClient();
  const [profile, contract, team] = await Promise.all([
    admin.from("company_profile").select(SETUP_PROFILE_COLUMNS).eq("company_id", companyId).maybeSingle(),
    admin
      .from("contract_templates")
      .select("id")
      .eq("company_id", companyId)
      .eq("is_default", true)
      .limit(1),
    admin
      .from("company_members")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "Active")
      .eq("granted_via_platform_admin", false),
  ]);
  // A read that fails shows no checklist rather than a wrong one.
  if (profile.error || contract.error || team.error) return null;
  return setupFactsFromRow(
    profile.data as SetupProfileRow | null,
    (contract.data ?? []).length > 0,
    team.count ?? 0
  );
}

/**
 * Every company's setup count, for Platform Admin › Companies: two paged
 * reads, not a query per company. `teams` is the directory's own team
 * count, so both pages agree on who counts.
 */
export async function listSetupSummaries(teams: Map<string, number>): Promise<Map<string, SetupSummary>> {
  const admin = createAdminClient();
  const [profiles, contracts] = await Promise.all([
    selectAll<SetupProfileRow>((from, to) =>
      admin.from("company_profile").select(SETUP_PROFILE_COLUMNS).order("company_id").range(from, to)
    ),
    selectAll<{ company_id: string }>((from, to) =>
      admin
        .from("contract_templates")
        .select("company_id")
        .eq("is_default", true)
        .order("company_id")
        .range(from, to)
    ),
  ]);
  const withContract = new Set(contracts.map((c) => c.company_id));
  const out = new Map<string, SetupSummary>();
  for (const row of profiles) {
    const facts = setupFactsFromRow(row, withContract.has(row.company_id), teams.get(row.company_id) ?? 0);
    out.set(row.company_id, setupSummary(setupItems(facts)));
  }
  return out;
}
