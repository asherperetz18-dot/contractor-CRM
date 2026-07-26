import { createClient } from "@/lib/supabase/server";
import type { CompanyProfile } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { CompanyProfileForm } from "./company-profile-form";

export default async function CompanyProfilePage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_profile")
    .select("*")
    .eq("id", 1)
    .single();

  return (
    <AdminGate>
      <CompanyProfileForm profile={data as CompanyProfile} />
    </AdminGate>
  );
}
