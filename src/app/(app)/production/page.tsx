import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { canEditSchedule, type Job } from "@/lib/data/types";
import { ProductionBoard } from "./production-board";

export default async function ProductionPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditSchedule(profile);
  const companyId = profile?.company_id ?? "";

  const [jobs, roster] = await Promise.all([
    // selectAll: a bare select stops at 1000 rows in silence -- a
    // production board that quietly drops the oldest jobs once the book
    // passes a thousand is exactly the page nobody would suspect.
    selectAll<Job>((f, t) =>
      supabase
        .from("jobs")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .range(f, t)
    ),
    // The WHOLE roster, active or not: the board and form narrow their
    // own pickers, and name lookups must keep resolving people who have
    // since been deactivated.
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
  ]);

  // Only the estimates the jobs on the board actually point at (never a
  // whole-table scan): a signed top-level contract per lead is what
  // "Open project" jumps to on the Projects board.
  const leadIds = [...new Set(jobs.map((j) => j.lead_id).filter((x): x is string => !!x))];
  const projectByLead: Record<string, string> = {};
  if (leadIds.length > 0) {
    const { data: signed } = await supabase
      .from("estimates")
      .select("id, lead_id, kind, signed_at")
      .eq("company_id", companyId)
      .eq("status", "Signed")
      .in("lead_id", leadIds)
      .returns<{ id: string; lead_id: string | null; kind: string | null; signed_at: string | null }[]>();
    (signed ?? [])
      .filter((e) => e.kind !== "change_order" && e.kind !== "completion")
      // Latest signature wins when a lead has several signed documents.
      .sort((a, b) => (a.signed_at ?? "").localeCompare(b.signed_at ?? ""))
      .forEach((e) => {
        if (e.lead_id) projectByLead[e.lead_id] = e.id;
      });
  }

  return (
    <ProductionBoard
      jobs={jobs}
      roster={roster}
      projectByLead={projectByLead}
      canWrite={canWrite}
      initialToday={new Date().toISOString().slice(0, 10)}
    />
  );
}
