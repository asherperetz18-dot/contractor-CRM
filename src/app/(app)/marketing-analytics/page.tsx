import { createClient } from "@/lib/supabase/server";
import type { Lead, Profile } from "@/lib/data/types";
import { AnalyticsView } from "./analytics-view";

export default async function MarketingAnalyticsPage() {
  const supabase = await createClient();
  const [{ data: leads }, { data: reps }] = await Promise.all([
    supabase.from("leads").select("*"),
    supabase
      .from("profiles")
      .select("id, name, email, phone, roles, status, created_at")
      .eq("status", "Active"),
  ]);

  return (
    <AnalyticsView leads={(leads as Lead[]) ?? []} reps={(reps as Profile[]) ?? []} />
  );
}
