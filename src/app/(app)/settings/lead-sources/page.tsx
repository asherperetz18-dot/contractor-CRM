import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/data/profile";
import { isoDay } from "@/lib/data/date-range";
import type { LeadSourceRow } from "@/lib/data/types";
import { AdminGate } from "@/components/admin-gate";
import { FieldOptionsTable } from "../field-options-table";
import { MergeValues } from "../merge-values";
import { CompanyDefaultLeadCost } from "./company-default-cost";
import { SourceSpend, type SpendLine } from "./source-spend";

export default async function LeadSourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const supabase = await createClient();
  const companyId = await getCurrentCompanyId();
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string) : isoDay(new Date()).slice(0, 7);

  const [{ data: rows }, { data: profile }, spend] = await Promise.all([
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
    // Null until migration 0165 has run: the section says so instead of erroring.
    supabase
      .from("marketing_spend")
      .select("source, amount_cents, note")
      .eq("company_id", companyId ?? "")
      .eq("month", `${month}-01`)
      .then(({ data, error }): SpendLine[] | null => (error ? null : ((data ?? []) as SpendLine[]))),
  ]);
  const sources = (rows as LeadSourceRow[]) ?? [];
  const companyDefault = profile?.default_lead_cost ?? null;

  return (
    <AdminGate>
      <FieldOptionsTable
        table="lead_sources"
        title="Lead Sources"
        description="Manage the list of sources available when creating or editing a lead, and what a lead from each one costs"
        itemLabel="Source"
        rows={sources}
        leadCost={{ companyDefault }}
      />
      {/* Keyed so a save that normalized "$1,250.50" shows back as 1250.5. */}
      <CompanyDefaultLeadCost key={String(companyDefault)} initial={companyDefault} />
      <MergeValues table="lead_sources" itemLabel="Source" />
      <SourceSpend
        month={month}
        sources={sources.map((s) => ({ id: s.id, name: s.name, boughtList: s.bought_list === true }))}
        spend={spend}
      />
    </AdminGate>
  );
}
