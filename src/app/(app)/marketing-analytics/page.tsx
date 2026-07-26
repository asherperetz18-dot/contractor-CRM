import { createClient } from "@/lib/supabase/server";
import type { Lead, PipelineStageRow, Profile } from "@/lib/data/types";
import { AnalyticsView } from "./analytics-view";

export default async function MarketingAnalyticsPage() {
  const supabase = await createClient();
  const [{ data: leads }, { data: reps }, { data: stages }] = await Promise.all([
    supabase.from("leads").select("*"),
    supabase
      .from("profiles")
      .select("id, name, email, phone, roles, status, created_at")
      .eq("status", "Active"),
    supabase.from("pipeline_stages").select("*").order("sort_order", { ascending: true }),
  ]);

  return (
    <AnalyticsView
      leads={(leads as Lead[]) ?? []}
      reps={(reps as Profile[]) ?? []}
      stages={(stages as PipelineStageRow[]) ?? []}
    />
  );
}
