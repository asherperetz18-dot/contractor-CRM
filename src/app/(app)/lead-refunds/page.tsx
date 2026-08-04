import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { canEditDispatch, type Lead } from "@/lib/data/types";
import { LeadRefundsView } from "./lead-refunds-view";

export default async function LeadRefundsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);
  const companyId = profile?.company_id ?? "";

  const [{ data: leads }, reps] = await Promise.all([
    // Only leads that have ever been in a refund flow -- the rest of the
    // book would just be noise on this page.
    supabase
      .from("leads")
      .select("*")
      .eq("company_id", companyId)
      .neq("refund_status", "None")
      .order("refund_requested_at", { ascending: false }),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
  ]);

  return (
    <LeadRefundsView
      leads={(leads as Lead[]) ?? []}
      reps={reps}
      canWrite={canWrite}
    />
  );
}
