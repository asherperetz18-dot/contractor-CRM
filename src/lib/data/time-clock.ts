import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { geocodeViaCensus, normalizeAddress } from "@/lib/weather-provider";
import { instantOfWallClock, isoDateInZone } from "@/lib/company-clock";
import { parseNaiveDateTime } from "@/lib/timezone";
import { DEFAULT_TIME_CLOCK_SETTINGS, type TimeClockSettings } from "@/lib/time-clock/settings";
import type { Zone } from "@/lib/time-clock/geo";

type Client = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;
type Admin = ReturnType<typeof createAdminClient>;

// The company's rules, or the defaults until an office saves the page
// (and while migration 0174 hasn't been run -- the read just fails).
export async function readTimeClockSettings(client: Client, companyId: string): Promise<TimeClockSettings> {
  const { data } = await client
    .from("time_clock_settings")
    .select("tracked_roles, zone_radius_m, overtime_weekly_hours, late_after_min, auto_clock_out_hours, trail_retention_days, office_address")
    .eq("company_id", companyId)
    .maybeSingle<TimeClockSettings>();
  if (!data) return DEFAULT_TIME_CLOCK_SETTINGS;
  return { ...data, overtime_weekly_hours: Number(data.overtime_weekly_hours) };
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

// Every place this person can "arrive" today: their appointments, and
// the office if the company set its address.
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
  if (settings.office_address) {
    const geo = await geocodeCached(admin, settings.office_address);
    if (geo) zones.push({ key: "office", label: "Office", eventId: null, ...geo });
  }
  return zones;
}

export function visitKey(visit: { event_id: string | null }): string {
  return visit.event_id ? `event:${visit.event_id}` : "office";
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
