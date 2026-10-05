import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId, getCurrentProfile } from "@/lib/data/profile";
import { isStrictAdmin } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { SettingsGrid } from "./settings-grid";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string }>;
}) {
  // ?card=logo opens the Logo card straight away -- the setup checklist
  // links here (DECISIONS #136).
  const { card } = await searchParams;
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const profile = await getCurrentProfile();
  const { data: companyProfile } = await supabase
    .from("company_profile")
    .select("logo_url")
    .eq("company_id", companyId ?? "")
    .single();

  return (
    <AdminGate>
      <SettingsGrid
        logoUrl={(companyProfile as { logo_url: string | null } | null)?.logo_url ?? null}
        isAdmin={isStrictAdmin(profile)}
        startCard={card === "logo" ? "logo" : null}
      />
    </AdminGate>
  );
}
