import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { repLeadStats, repLeadStatsFromRows, type RepLeadStatsRow } from "@/lib/report-leads";
import { SalespeopleGrid } from "./salespeople-grid";

export default async function SalespeoplePage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const companyId = profile?.company_id ?? "";

  // The tallies are grouped in the database (rep_lead_stats, 0156):
  // one row per rep instead of a scan of every lead -- at 79k leads
  // the scan was ~80 sequential pages before the grid could say four
  // numbers per rep. Until that migration has run, the function is
  // missing and the page falls back to the slim scan it always did.
  const [allReps, stats] = await Promise.all([
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    (async () => {
      const { data, error } = await supabase.rpc("rep_lead_stats", { p_company: companyId });
      if (!error && data) return repLeadStatsFromRows(data as RepLeadStatsRow[]);
      const slim = await selectAll<{
        assigned_to: string | null;
        partner_rep_id: string | null;
        stage: string;
        value: number;
      }>((f, t) =>
        supabase
          .from("leads")
          .select("assigned_to, partner_rep_id, stage, value")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .range(f, t)
      );
      return repLeadStats(slim);
    })(),
  ]);
  const reps = [...allReps].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <SalespeopleGrid
      reps={reps}
      statsByRep={Object.fromEntries(stats)}
    />
  );
}
