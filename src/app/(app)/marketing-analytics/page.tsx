import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { presetWindow } from "@/lib/data/date-range";
import { getAnalyticsLeads } from "@/lib/actions/marketing-analytics";
import type { PipelineStageRow } from "@/lib/data/types";
import { AnalyticsView, type SignedContract } from "./analytics-view";

export default async function MarketingAnalyticsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const companyId = profile?.company_id ?? "";

  const [leads, allReps, { data: stages }, { data: estimates }] = await Promise.all([
    // Only the default window's slice -- the whole 79k book used to
    // ride to the browser here (#019/#020). 31 days for the view's
    // 30-day default, so the client's own clock can never trim the
    // boundary day; the view re-filters exactly, and other ranges are
    // fetched on demand.
    getAnalyticsLeads(presetWindow("31")),
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
      initialLeads={leads}
      reps={reps}
      stages={(stages as PipelineStageRow[]) ?? []}
      signedContracts={(estimates as SignedContract[]) ?? []}
    />
  );
}
