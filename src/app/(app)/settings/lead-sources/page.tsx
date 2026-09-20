import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import type { LeadSourceRow } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { FieldOptionsTable } from "../field-options-table";
import { MergeValues } from "../merge-values";
import { CompanyDefaultLeadCost } from "./company-default-cost";

export default async function LeadSourcesPage() {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const [{ data: rows }, { data: profile }] = await Promise.all([
    supabase
      .from("lead_sources")
      .select("*")
      .eq("company_id", companyId ?? "")
      .order("sort_order", { ascending: true }),
    supabase
      .from("company_profile")
      .select("default_lead_cost")
      .eq("company_id", companyId ?? "")
      .maybeSingle<{ default_lead_cost: number | null }>(),
  ]);
  const companyDefault = profile?.default_lead_cost ?? null;

  return (
    <AdminGate>
      <FieldOptionsTable
        table="lead_sources"
        title="Lead Sources"
        description="Manage the list of sources available when creating or editing a lead, and what a lead from each one costs"
        itemLabel="Source"
        rows={(rows as LeadSourceRow[]) ?? []}
        leadCost={{ companyDefault }}
      />
      {/* Keyed so a save that normalized "$1,250.50" shows back as 1250.5. */}
      <CompanyDefaultLeadCost key={String(companyDefault)} initial={companyDefault} />
      <MergeValues table="lead_sources" itemLabel="Source" />
    </AdminGate>
  );
}
