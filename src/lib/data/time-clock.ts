import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { geocodeViaCensus, normalizeAddress } from "@/lib/weather-provider";
import { instantOfWallClock, isoDateInZone } from "@/lib/company-clock";
import { parseNaiveDateTime } from "@/lib/timezone";
import { DEFAULT_TIME_CLOCK_SETTINGS, type TimeClockSettings } from "@/lib/time-clock/settings";
import { jobIsLiveToday, type Zone } from "@/lib/time-clock/geo";

type Client = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;
type Admin = ReturnType<typeof createAdminClient>;

type ClockInCheckSettings = Pick<TimeClockSettings, "clock_in_check" | "check_roles">;

// The clock-in location check's settings (0185), read on their own so a
// database that hasn't run 0185 still gets the rest of the company's
// rules. Null until 0185 has run.
export async function readClockInCheck(client: Client, companyId: string): Promise<ClockInCheckSettings | null> {
  const { data, error } = await client
    .from("time_clock_settings")
    .select("clock_in_check, check_roles")
    .eq("company_id", companyId)
    .maybeSingle<ClockInCheckSettings>();
  if (error) return null;
  return data ?? { clock_in_check: DEFAULT_TIME_CLOCK_SETTINGS.clock_in_check, check_roles: DEFAULT_TIME_CLOCK_SETTINGS.check_roles };
}

// The company's rules, or the defaults until an office saves the page
// (and while migration 0174 hasn't been run -- the read just fails).
export async function readTimeClockSettings(client: Client, companyId: string): Promise<TimeClockSettings> {
  const [{ data }, check] = await Promise.all([
    client
      .from("time_clock_settings")
      .select("tracked_roles, zone_radius_m, overtime_weekly_hours, late_after_min, auto_clock_out_hours, trail_retention_days, office_address")
      .eq("company_id", companyId)
      .maybeSingle<Omit<TimeClockSettings, keyof ClockInCheckSettings>>(),
    readClockInCheck(client, companyId),
  ]);
  const base = data ? { ...data, overtime_weekly_hours: Number(data.overtime_weekly_hours) } : DEFAULT_TIME_CLOCK_SETTINGS;
  // Before 0185 there's nowhere to keep a verdict, so the check is off.
  return { ...base, ...(check ?? { clock_in_check: "off", check_roles: [] }) };
}

// address -> lat/lng through the shared address_geocode cache (0135,
// service-role only). A miss asks the free Census geocoder once and
// caches the answer, including "not found", so a bad address costs one
// lookup, not one per ping.
export async function geocodeCached(admin: Admin, address: string): Promise<{ lat: number; lng: number } | null> {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  const { data } = await admin
    .from("address_geocode")
    .select("lat, lng")
    .eq("normalized_address", normalized)
    .maybeSingle<{ lat: number | null; lng: number | null }>();
  if (data) return data.lat === null || data.lng === null ? null : { lat: Number(data.lat), lng: Number(data.lng) };
  const geo = await geocodeViaCensus(address).catch(() => null);
  await admin
    .from("address_geocode")
    .upsert({ normalized_address: normalized, lat: geo?.lat ?? null, lng: geo?.lng ?? null });
  return geo;
}

export type TodaysAppointment = {
  id: string;
  title: string;
  start: Date | null;
  address: string | null;
};

// The appointments someone is on today (either assignee seat), with the
// address each one happens at: the job's, else the lead's.
export async function appointmentsForToday(
  client: Client,
  companyId: string,
  profileIds: string[],
  ianaZone: string
): Promise<(TodaysAppointment & { assignees: string[] })[]> {
  if (profileIds.length === 0) return [];
  const today = isoDateInZone(new Date(), ianaZone);
  const ids = profileIds.join(",");
  const { data: events } = await client
    .from("events")
    .select("id, title, date, time, lead_id, job_id, assigned_to, second_assigned_to, status")
    .eq("company_id", companyId)
    .eq("date", today)
    .or(`assigned_to.in.(${ids}),second_assigned_to.in.(${ids})`);
  type Ev = {
    id: string;
    title: string | null;
    date: string;
    time: string | null;
    lead_id: string | null;
    job_id: string | null;
    assigned_to: string | null;
    second_assigned_to: string | null;
    status: string | null;
  };
  const rows = ((events as Ev[] | null) ?? []).filter((e) => !/cancel/i.test(e.status ?? ""));
  const leadIds = [...new Set(rows.map((e) => e.lead_id).filter((x): x is string => !!x))];
  const jobIds = [...new Set(rows.map((e) => e.job_id).filter((x): x is string => !!x))];
  const [{ data: leads }, { data: jobs }] = await Promise.all([
    leadIds.length
      ? client.from("leads").select("id, address, zip").in("id", leadIds)
      : Promise.resolve({ data: [] }),
    jobIds.length ? client.from("jobs").select("id, address").in("id", jobIds) : Promise.resolve({ data: [] }),
  ]);
  const leadAddr = new Map(
    ((leads as { id: string; address: string | null; zip: string | null }[] | null) ?? []).map((l) => [
      l.id,
      l.address ? [l.address, l.zip].filter(Boolean).join(" ") : null,
    ])
  );
  const jobAddr = new Map(
    ((jobs as { id: string; address: string | null }[] | null) ?? []).map((j) => [j.id, j.address])
  );
  return rows.map((e) => ({
    id: e.id,
    title: e.title || "Appointment",
    start: e.time ? instantOfWallClock(parseNaiveDateTime(e.date, e.time), ianaZone) : null,
    address: (e.job_id && jobAddr.get(e.job_id)) || (e.lead_id && leadAddr.get(e.lead_id)) || null,
    assignees: [e.assigned_to, e.second_assigned_to].filter((x): x is string => !!x),
  }));
}

// Every place this person can "arrive" today: their appointments, the
// production jobs they're on (a crew on day 3 of a job has no
// appointment that day), and the office if the company set its address.
// Appointments come first, so where one sits at a job's address it wins
// the tie and attendance still counts against it.
export async function zonesForToday(
  admin: Admin,
  companyId: string,
  profileId: string,
  ianaZone: string,
  settings: TimeClockSettings
): Promise<Zone[]> {
  const appts = await appointmentsForToday(admin, companyId, [profileId], ianaZone);
  const zones: Zone[] = [];
  for (const a of appts) {
    if (!a.address) continue;
    const geo = await geocodeCached(admin, a.address);
    if (geo) zones.push({ key: `event:${a.id}`, label: a.title, eventId: a.id, ...geo });
  }
  const today = isoDateInZone(new Date(), ianaZone);
  const { data: jobs } = await admin
    .from("jobs")
    .select("id, name, address, status, start_date, end_date")
    .eq("company_id", companyId)
    .eq("assigned_to", profileId)
    .in("status", ["In Progress", "Not Started"]);
  type JobRow = { id: string; name: string; address: string | null; status: string; start_date: string | null; end_date: string | null };
  for (const j of (jobs as JobRow[] | null) ?? []) {
    if (!j.address || !jobIsLiveToday(j, today)) continue;
    const geo = await geocodeCached(admin, j.address);
    if (geo) zones.push({ key: `job:${j.id}`, label: j.name, eventId: null, jobId: j.id, ...geo });
  }
  if (settings.office_address) {
    const geo = await geocodeCached(admin, settings.office_address);
    if (geo) zones.push({ key: "office", label: "Office", eventId: null, ...geo });
  }
  return zones;
}

// Close whatever visit is open for this person (clock-out, break, or
// they walked out of the zone).
export async function closeOpenVisit(admin: Admin, companyId: string, profileId: string, at: string) {
  await admin
    .from("site_visits")
    .update({ left_at: at })
    .eq("company_id", companyId)
    .eq("profile_id", profileId)
    .is("left_at", null);
}
