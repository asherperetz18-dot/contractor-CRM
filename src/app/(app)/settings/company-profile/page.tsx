import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import type { CompanyProfile } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { CompanyProfileForm } from "./company-profile-form";

export default async function CompanyProfilePage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const { data } = await supabase
    .from("company_profile")
    .select("*")
    .eq("company_id", companyId ?? "")
    .single();

  return (
    <AdminGate>
      <CompanyProfileForm profile={data as CompanyProfile} />
    </AdminGate>
  );
}
