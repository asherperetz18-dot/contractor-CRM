import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { canUseSalesCenter, type Event, type Lead } from "@/lib/data/types";
import { AppointmentReportsView } from "./appointment-reports-view";

export default async function AppointmentReportsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canUseSalesCenter(profile);
  const companyId = profile?.company_id ?? "";

  const [events, leads, reps] = await Promise.all([
    // Paged: appointments accumulate faster than anything else here, and
    // a plain select stops at 1000 rows without saying so.
    selectAll<Event>((f, t) =>
      supabase
        .from("events")
        .select("*")
        .eq("company_id", companyId)
        .order("date", { ascending: false })
        .range(f, t)
    ),
    selectAll<Lead>((f, t) =>
      supabase.from("leads").select("*").eq("company_id", companyId).range(f, t)
    ),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
  ]);

  return (
    <AppointmentReportsView
      events={events}
      leads={leads}
      reps={reps}
      canWrite={canWrite}
    />
  );
}
