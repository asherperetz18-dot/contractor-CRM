import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/data/types";

type CompanyMemberRow = {
  roles: Profile["roles"];
  status: Profile["status"];
  can_delete_leads: boolean;
  profiles: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    created_at: string;
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
    .select("roles, status, can_delete_leads, profiles(id, name, email, phone, created_at)")
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
      created_at: row.profiles.created_at,
    }));
}
