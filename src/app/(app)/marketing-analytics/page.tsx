import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { presetWindow } from "@/lib/data/date-range";
import { getMarketingAnalytics } from "@/lib/actions/marketing-analytics";
import { isAdminRole, type PipelineStageRow } from "@/lib/data/types";
import { AnalyticsView } from "./analytics-view";

export default async function MarketingAnalyticsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const companyId = profile?.company_id ?? "";

  const [initial, members, { data: stages }] = await Promise.all([
    // The default window's numbers, reduced server-side; other ranges
    // are fetched on demand. No lead rows ride to the browser.
    getMarketingAnalytics(presetWindow("30"), { excludeBoughtLists: false }),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase.from("pipeline_stages").select("*").eq("company_id", companyId).order("sort_order", { ascending: true }),
  ]);
  // Names read the whole roster: a departed rep with contracts in the
  // period stays named, never "Unnamed".
  const repNames = Object.fromEntries(members.map((m) => [m.id, m.name || m.email || "Unnamed"]));

  return (
    <AnalyticsView
      initial={initial}
      repNames={repNames}
      stages={(stages as PipelineStageRow[]) ?? []}
      canManageSpend={isAdminRole(profile)}
    />
  );
}
