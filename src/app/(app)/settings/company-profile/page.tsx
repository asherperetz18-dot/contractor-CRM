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

  // The sales-tax column (migration 0059) is read here rather than added
  // to CompanyProfile: like the AI and webhook columns, it is one page's
  // concern, and the row type stays the shape the rest of the app shares.
  const taxRateBp = Number((data as { tax_rate_bp?: number } | null)?.tax_rate_bp) || 0;

  return (
    <AdminGate>
      <CompanyProfileForm profile={data as CompanyProfile} taxRateBp={taxRateBp} />
    </AdminGate>
  );
}
