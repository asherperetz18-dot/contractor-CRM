import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import type { Job } from "@/lib/data/types";
import { ProductionBoard } from "./production-board";

export default async function ProductionPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite =
    (profile?.roles.includes("Office") || profile?.roles.includes("Field")) ?? false;
  const companyId = profile?.company_id ?? "";

  const [{ data: jobs }, allAssignees] = await Promise.all([
    supabase.from("jobs").select("*").eq("company_id", companyId).order("created_at", { ascending: false }),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
  ]);
  const assignees = allAssignees
    .filter((r) => r.status === "Active")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <ProductionBoard
      jobs={(jobs as Job[]) ?? []}
      assignees={assignees}
      canWrite={canWrite}
    />
  );
}
