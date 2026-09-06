import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/data/types";
import type { AccountingFlags } from "@/lib/data/accounting-access";

// A roster row: everything Profile carries, plus the two accounting
// flags. They are not on Profile itself because only this roster and
// the Users & Roles table read another person's money permissions.
export type CompanyMember = Profile & AccountingFlags;

type CompanyMemberRow = {
  roles: Profile["roles"];
  status: Profile["status"];
  can_delete_leads: boolean;
  can_view_estimates: boolean;
  can_create_estimates: boolean;
  // Optional until migration 0126 has run -- see the select below.
  can_send_estimates?: boolean;
  // Optional until migration 0127 has run, same reason.
  can_view_financials?: boolean;
  can_view_profit_loss?: boolean;
  is_dispatch_supervisor: boolean;
  // Optional until migration 0132 has run, same reason.
  granted_via_platform_admin?: boolean;
  profiles: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    created_at: string;
    is_super_admin: boolean | null;
  } | null;
};

// Team roster for one company -- profiles joined with their
// company_members row for that company. Replaces querying `profiles`
// directly for roles/status/can_delete_leads, which are no longer
// meaningful outside of a specific company.
//
// A Platform Admin's row here (migration 0132) is real -- the same
// company_members row RLS reads to grant them access -- but it exists
// because they operate the platform, not because this company hired
// them, so it's filtered out of the one roster every consumer of this
// function builds on: Users & Roles, assignment pickers, presence,
// reports. All of them should see this company's actual team, not a
// name nobody there recognizes.
export async function getCompanyMembers(companyId: string): Promise<CompanyMember[]> {
  const supabase = await createClient();
  // "*" for the member row, same reason as getCurrentProfile: a column
  // named here before its migration has run would empty the whole
  // roster, and a missing column reading as undefined is harmless.
  const { data } = await supabase
    .from("company_members")
    .select("*, profiles(id, name, email, phone, created_at, is_super_admin)")
    .eq("company_id", companyId);

  return ((data ?? []) as unknown as CompanyMemberRow[])
    .filter((row): row is CompanyMemberRow & { profiles: NonNullable<CompanyMemberRow["profiles"]> } =>
      row.profiles !== null && row.granted_via_platform_admin !== true
    )
    .map((row) => ({
      id: row.profiles.id,
      name: row.profiles.name,
      email: row.profiles.email,
      phone: row.profiles.phone,
      roles: row.roles,
      status: row.status,
      can_delete_leads: row.can_delete_leads,
      can_view_estimates: row.can_view_estimates,
      can_create_estimates: row.can_create_estimates,
      can_send_estimates: row.can_send_estimates !== false,
      // Default FALSE, unlike send above: an ability nobody had before,
      // rather than one being taken away. Undefined (0127 not yet run)
      // reads as off, which costs nobody anything -- Office, Admin and
      // Bookkeeping hold the money screens by role.
      can_view_financials: row.can_view_financials === true,
      can_view_profit_loss: row.can_view_profit_loss === true,
      is_dispatch_supervisor: row.is_dispatch_supervisor === true,
      is_super_admin: row.profiles.is_super_admin === true,
      created_at: row.profiles.created_at,
    }));
}
