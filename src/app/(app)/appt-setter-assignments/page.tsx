import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { canEditDispatch, type Lead, type SetterContact } from "@/lib/data/types";
import { SetterAssignments } from "./setter-assignments";

export default async function ApptSetterAssignmentsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);
  const companyId = profile?.company_id ?? "";

  const [allReps, { data: leads }, { data: assignments }] = await Promise.all([
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase.from("leads").select("*").eq("company_id", companyId).order("created_at", { ascending: false }),
    supabase.from("setter_contacts").select("*").eq("company_id", companyId),
  ]);
  const reps = allReps.filter((r) => r.status === "Active").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <SetterAssignments
      reps={reps}
      leads={(leads as Lead[]) ?? []}
      assignments={(assignments as SetterContact[]) ?? []}
      canWrite={canWrite}
    />
  );
}
