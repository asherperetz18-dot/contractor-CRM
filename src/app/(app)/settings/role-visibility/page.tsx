import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import type { RolePageVisibilityRow } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { getRoleNamesCached } from "@/lib/data/company-chrome";
import { STANDARD_ROLE_NAMES } from "@/lib/role-names";
import { RoleVisibilityTable } from "./role-visibility-table";

export default async function RoleVisibilityPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const [{ data: rows }, roleNames] = await Promise.all([
    supabase
      .from("role_page_visibility")
      .select("id, role, page_key, visible")
      .eq("company_id", companyId ?? ""),
    companyId ? getRoleNamesCached(companyId) : Promise.resolve(STANDARD_ROLE_NAMES),
  ]);

  return (
    <AdminGate>
      <RoleVisibilityTable overrides={(rows as RolePageVisibilityRow[]) ?? []} roleNames={roleNames} />
    </AdminGate>
  );
}
