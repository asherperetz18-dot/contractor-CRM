import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/data/types";

type CompanyMemberRow = {
  roles: Profile["roles"];
  status: Profile["status"];
  can_delete_leads: boolean;
  can_view_estimates: boolean;
  can_create_estimates: boolean;
  is_dispatch_supervisor: boolean;
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
export async function getCompanyMembers(companyId: string): Promise<Profile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_members")
    .select("roles, status, can_delete_leads, can_view_estimates, can_create_estimates, is_dispatch_supervisor, profiles(id, name, email, phone, created_at, is_super_admin)")
    .eq("company_id", companyId);

  return ((data ?? []) as unknown as CompanyMemberRow[])
    .filter((row): row is CompanyMemberRow & { profiles: NonNullable<CompanyMemberRow["profiles"]> } =>
      row.profiles !== null
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
      is_dispatch_supervisor: row.is_dispatch_supervisor === true,
      is_super_admin: row.profiles.is_super_admin === true,
      created_at: row.profiles.created_at,
    }));
}
