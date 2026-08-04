import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import type { Lead, PipelineStageRow } from "@/lib/data/types";
import { AnalyticsView } from "./analytics-view";

export default async function MarketingAnalyticsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const companyId = profile?.company_id ?? "";

  const [leads, allReps, { data: stages }] = await Promise.all([
    selectAll<Lead>((f, t) =>
      supabase.from("leads").select("*").eq("company_id", companyId).range(f, t)
    ),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase.from("pipeline_stages").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
  ]);
  const reps = allReps.filter((r) => r.status === "Active");

  return (
    <AnalyticsView
      leads={(leads as Lead[]) ?? []}
      reps={reps}
      stages={(stages as PipelineStageRow[]) ?? []}
    />
  );
}
