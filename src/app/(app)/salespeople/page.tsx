import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { repLeadStats } from "@/lib/report-leads";
import { SalespeopleGrid } from "./salespeople-grid";

export default async function SalespeoplePage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const companyId = profile?.company_id ?? "";

  // The tallies come from a slim scan (three columns, never full rows)
  // reduced server-side -- the whole book used to ride to the browser
  // for four numbers per rep. See src/lib/report-leads.ts and its tests.
  const [allReps, slim] = await Promise.all([
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    selectAll<{ assigned_to: string | null; stage: string; value: number }>((f, t) =>
      supabase
        .from("leads")
        .select("assigned_to, stage, value")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .range(f, t)
    ),
  ]);
  const reps = [...allReps].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  const stats = repLeadStats(slim);

  return (
    <SalespeopleGrid
      reps={reps}
      statsByRep={Object.fromEntries(stats)}
    />
  );
}
