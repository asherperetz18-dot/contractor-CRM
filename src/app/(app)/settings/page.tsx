import { createClient } from "@/lib/supabase/server";
import { AdminGate } from "@/components/admin-gate";
import { SettingsGrid } from "./settings-grid";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: companyProfile } = await supabase
    .from("company_profile")
    .select("logo_url")
    .eq("id", 1)
    .single();

  return (
    <AdminGate>
      <SettingsGrid
        logoUrl={(companyProfile as { logo_url: string | null } | null)?.logo_url ?? null}
      />
    </AdminGate>
  );
}
