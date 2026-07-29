import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import type { Lead } from "@/lib/data/types";
import { SalespeopleGrid } from "./salespeople-grid";

export default async function SalespeoplePage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const companyId = profile?.company_id ?? "";

  const [allReps, { data: leads }] = await Promise.all([
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase.from("leads").select("*").eq("company_id", companyId),
  ]);
  const reps = [...allReps].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <SalespeopleGrid
      reps={reps}
      leads={(leads as Lead[]) ?? []}
    />
  );
}
