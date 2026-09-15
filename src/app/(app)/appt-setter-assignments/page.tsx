import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { leadsLiteByIds } from "@/lib/data/lead-lite";
import { canEditDispatch, type SetterContact } from "@/lib/data/types";
import { SetterAssignments } from "./setter-assignments";

export default async function ApptSetterAssignmentsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);
  const companyId = profile?.company_id ?? "";

  const [allReps, { data: assignments }] = await Promise.all([
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase.from("setter_contacts").select("*").eq("company_id", companyId),
  ]);
  // Only the assigned contacts -- the "add a contact" picker searches
  // the book server-side now, so the whole book no longer rides along.
  const leads = await leadsLiteByIds(
    supabase,
    companyId,
    ((assignments ?? []) as SetterContact[]).map((a) => a.lead_id)
  );
  const reps = allReps.filter((r) => r.status === "Active").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <SetterAssignments
      reps={reps}
      leads={leads}
      assignments={(assignments as SetterContact[]) ?? []}
      canWrite={canWrite}
    />
  );
}
