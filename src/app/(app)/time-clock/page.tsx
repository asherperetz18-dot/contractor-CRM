import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyZone } from "@/lib/data/company-today";
import { appointmentsForToday, readTimeClockSettings } from "@/lib/data/time-clock";
import { dayStartInZone, isoDateInZone } from "@/lib/company-clock";
import { shiftState, type PunchRow } from "@/lib/time-clock/hours";
import { usesTimeClock } from "@/lib/time-clock/settings";
import { TimeClockView, type VisitRow } from "./time-clock-view";

export const dynamic = "force-dynamic";

export default async function TimeClockPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await createClient();
  const zone = await getCompanyZone();
  const settings = await readTimeClockSettings(supabase, profile.company_id);
  const dayStart = dayStartInZone(isoDateInZone(new Date(), zone), zone).toISOString();

  const [{ data: punches, error }, { data: visits }, { data: notice }, appts] = await Promise.all([
    supabase
      .from("time_punches")
      .select("id, profile_id, clock_in, clock_out, end_reason")
      .eq("company_id", profile.company_id)
      .eq("profile_id", profile.id)
      .or(`clock_in.gte.${dayStart},clock_out.is.null,clock_out.gte.${dayStart}`)
      .order("clock_in", { ascending: true }),
    supabase
      .from("site_visits")
      .select("id, label, arrived_at, left_at")
      .eq("company_id", profile.company_id)
      .eq("profile_id", profile.id)
      .gte("arrived_at", dayStart)
      .order("arrived_at", { ascending: true }),
    supabase
      .from("tracking_notices")
      .select("accepted_at")
      .eq("company_id", profile.company_id)
      .eq("profile_id", profile.id)
      .maybeSingle(),
    appointmentsForToday(supabase, profile.company_id, [profile.id], zone),
  ]);

  const rows = (punches as PunchRow[] | null) ?? [];
  return (
    <>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Time Clock</h1>
          <p className="module-sub">Clock in and out. Your location is shared only while you&apos;re on the clock.</p>
        </div>
      </div>
      {error ? (
        <p className="error-note">
          The time clock isn&apos;t set up yet — an admin needs to run migration 0174_time_clock.sql.
        </p>
      ) : (
        <TimeClockView
          zone={zone}
          usesClock={usesTimeClock(profile.roles, settings)}
          noticeAccepted={!!notice}
          state={shiftState(rows, new Date())}
          punches={rows}
          visits={(visits as VisitRow[] | null) ?? []}
          appointments={appts
            .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0))
            .map((a) => ({ id: a.id, title: a.title, start: a.start?.toISOString() ?? null }))}
        />
      )}
    </>
  );
}
