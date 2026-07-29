import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import { AdminGate } from "@/components/admin-gate";
import { SettingsGrid } from "./settings-grid";

export default async function SettingsPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const { data: companyProfile } = await supabase
    .from("company_profile")
    .select("logo_url")
    .eq("company_id", companyId ?? "")
    .single();

  return (
    <AdminGate>
      <SettingsGrid
        logoUrl={(companyProfile as { logo_url: string | null } | null)?.logo_url ?? null}
      />
    </AdminGate>
  );
}
