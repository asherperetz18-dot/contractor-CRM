import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import type { RolePageVisibilityRow } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { RoleVisibilityTable } from "./role-visibility-table";

export default async function RoleVisibilityPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const { data: rows } = await supabase
    .from("role_page_visibility")
    .select("id, role, page_key, visible")
    .eq("company_id", companyId ?? "");

  return (
    <AdminGate>
      <RoleVisibilityTable overrides={(rows as RolePageVisibilityRow[]) ?? []} />
    </AdminGate>
  );
}
