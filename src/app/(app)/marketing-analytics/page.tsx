import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import type { PipelineStageRow } from "@/lib/data/types";
import { AnalyticsView, type AnalyticsLead, type SignedContract } from "./analytics-view";

export default async function MarketingAnalyticsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const companyId = profile?.company_id ?? "";

  const [leads, allReps, { data: stages }, { data: estimates }] = await Promise.all([
    // Exactly the fields the funnel math reads -- full rows (notes
    // included) used to ride along for every lead in the company.
    selectAll<AnalyticsLead>((f, t) =>
      supabase
        .from("leads")
        .select("id, contact_type, company_name, first_name, last_name, source, stage, value, created_at, won_at, has_appt, assigned_to, lead_cost, phone")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .range(f, t)
    ),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase.from("pipeline_stages").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
    // Signed contracts decide which leads a source actually sold. The
    // pipeline stage does not: four leads here sit at "Won" with no
    // contract behind them, which would credit a source with revenue
    // nobody committed to.
    supabase
      .from("estimates")
      .select("lead_id, status, kind, total_cents")
      .eq("company_id", companyId)
      .eq("status", "Signed"),
  ]);
  const reps = allReps.filter((r) => r.status === "Active");

  return (
    <AnalyticsView
      leads={leads}
      reps={reps}
      stages={(stages as PipelineStageRow[]) ?? []}
      signedContracts={(estimates as SignedContract[]) ?? []}
    />
  );
}
