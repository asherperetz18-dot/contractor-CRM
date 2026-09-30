import { companyToday } from "@/lib/data/company-today";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { canEditSchedule, isAdminRole, type Job } from "@/lib/data/types";
import { projectFactsByLead, type ProjectDoc, type ProjectFacts } from "@/lib/production-board";
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
  // whole-table scan): each lead's contracts and completion certificates
  // are what the card's column and its "Open project" link are read from
  // -- the same documents the Projects page reads its status from.
  const leadIds = [...new Set(jobs.map((j) => j.lead_id).filter((x): x is string => !!x))];
  const docs: ProjectDoc[] = [];
  for (let i = 0; i < leadIds.length; i += 200) {
    const slice = leadIds.slice(i, i + 200);
    const query = (cols: string) =>
      supabase
        .from("estimates")
        .select(cols)
        .eq("company_id", companyId)
        .in("status", ["Signed", "Void"])
        .in("lead_id", slice)
        .returns<ProjectDoc[]>();
    const base = "id, lead_id, kind, status, parent_estimate_id, signed_at, completed_on";
    let res = await query(`${base}, project_on_hold`);
    // project_on_hold arrives with migration 0093; until it has run, the
    // board still reads Complete and Cancelled, just no hold.
    if (res.error) res = await query(base);
    docs.push(...(res.data ?? []));
  }
  const projectFacts: Record<string, ProjectFacts> = Object.fromEntries(projectFactsByLead(docs));

  return (
    <ProductionBoard
      jobs={jobs}
      roster={roster}
      projectFacts={projectFacts}
      canWrite={canWrite}
      canSetProjectHold={isAdminRole(profile)}
      initialToday={await companyToday()}
    />
  );
}
