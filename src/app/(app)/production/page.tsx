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

  const [jobs, allAssignees] = await Promise.all([
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
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
  ]);
  const assignees = allAssignees
    .filter((r) => r.status === "Active")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <ProductionBoard
      jobs={jobs}
      assignees={assignees}
      canWrite={canWrite}
    />
  );
}
