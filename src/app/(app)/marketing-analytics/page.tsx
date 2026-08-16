import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import type { Lead, PipelineStageRow } from "@/lib/data/types";
import { AnalyticsView, type SignedContract } from "./analytics-view";

export default async function MarketingAnalyticsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const companyId = profile?.company_id ?? "";

  const [leads, allReps, { data: stages }, { data: estimates }] = await Promise.all([
    selectAll<Lead>((f, t) =>
      supabase.from("leads").select("*").eq("company_id", companyId).range(f, t)
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
      leads={(leads as Lead[]) ?? []}
      reps={reps}
      stages={(stages as PipelineStageRow[]) ?? []}
      signedContracts={(estimates as SignedContract[]) ?? []}
    />
  );
}
