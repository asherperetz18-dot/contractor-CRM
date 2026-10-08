import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/data/select-all";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { leadsLiteByIds } from "@/lib/data/lead-lite";
import { canUseSalesCenter, type Event } from "@/lib/data/types";
import { AppointmentReportsView } from "./appointment-reports-view";
import { staffPageLabel } from "@/lib/staff-words";
import { getCompanyWordsCached } from "@/lib/data/company-chrome";
import { companyToday } from "@/lib/data/company-today";
import { appointmentReportRange, appointmentReportWindow } from "@/lib/appointment-reports-range";

export default async function AppointmentReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  // The period rides in the address, and a link can open the report on
  // one (the Daily Brief's Showed / No-show tile does); otherwise the
  // last 30 days, as always.
  const range = appointmentReportRange(await searchParams);
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canUseSalesCenter(profile);
  const companyId = profile?.company_id ?? "";

  // Only the period in the address, up to today on the company's clock --
  // this page used to load every appointment the company ever had. The
  // report counts this same window from the same today, handed down, so
  // it reads no clock while it renders. Paged: appointments accumulate
  // faster than anything else here, and a plain select stops at 1000
  // rows without saying so.
  const today = await companyToday();
  const win = appointmentReportWindow(range, today);
  const [events, reps] = await Promise.all([
    selectAll<Event>((f, t) => {
      let q = supabase.from("events").select("*").eq("company_id", companyId).lte("date", win.to);
      if (win.from) q = q.gte("date", win.from);
      return q
        .order("date", { ascending: false })
        .order("id")
        .range(f, t);
    }),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
  ]);

  // Only the contacts these appointments reference -- the whole book
  // used to ride along just to print names next to the rows.
  const leads = await leadsLiteByIds(supabase, companyId, events.map((e) => e.lead_id));

  return (
    <AppointmentReportsView
      query={range}
      today={today}
      title={staffPageLabel("/appointment-reports", "Appointment Reports", await getCompanyWordsCached(companyId))}
      events={events}
      leads={leads}
      reps={reps}
      canWrite={canWrite}
    />
  );
}
