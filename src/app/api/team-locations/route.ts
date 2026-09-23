import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { getCompanyMembers } from "@/lib/data/company";
import { liveStatus, type Ping } from "@/lib/time-clock/attendance";
import { shiftState, type PunchRow } from "@/lib/time-clock/hours";

/**
 * Everyone on the clock, where they are, for the Team Map's refresh.
 * Office/Admin only -- and RLS would return nobody else's rows anyway.
 * A route (not an action) because the map polls it (DECISIONS #062).
 */

export type TeamLocation = {
  id: string;
  name: string;
  status: ReturnType<typeof liveStatus>;
  lat: number | null;
  lng: number | null;
  place: string | null;
  since: string | null;
  updatedAt: string | null;
};

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const supabase = await createClient();
  const companyId = profile.company_id;
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [{ data: punches, error }, { data: visits }, members] = await Promise.all([
    supabase
      .from("time_punches")
      .select("id, profile_id, clock_in, clock_out, end_reason")
      .eq("company_id", companyId)
      .or(`clock_out.is.null,clock_out.gte.${since}`),
    supabase
      .from("site_visits")
      .select("profile_id, label, arrived_at")
      .eq("company_id", companyId)
      .is("left_at", null),
    getCompanyMembers(companyId),
  ]);
  if (error) return NextResponse.json({ error: "The time clock isn't set up yet (migration 0174)." }, { status: 500 });

  const byPerson = new Map<string, PunchRow[]>();
  for (const p of (punches as PunchRow[]) ?? []) {
    byPerson.set(p.profile_id, [...(byPerson.get(p.profile_id) ?? []), p]);
  }
  const onClock = [...byPerson.entries()].filter(([, ps]) => shiftState(ps, now) !== "off");
  const ids = onClock.map(([id]) => id);

  // Only the last half hour of fixes: enough for "latest" and "moving?".
  const { data: pings } = ids.length
    ? await supabase
        .from("location_pings")
        .select("profile_id, recorded_at, lat, lng")
        .eq("company_id", companyId)
        .in("profile_id", ids)
        .gte("recorded_at", new Date(now.getTime() - 30 * 60 * 1000).toISOString())
        .order("recorded_at", { ascending: false })
    : { data: [] };
  const pingsBy = new Map<string, Ping[]>();
  for (const p of (pings as (Ping & { profile_id: string })[]) ?? []) {
    pingsBy.set(p.profile_id, [...(pingsBy.get(p.profile_id) ?? []), { ...p, lat: Number(p.lat), lng: Number(p.lng) }]);
  }
  const visitBy = new Map(
    ((visits as { profile_id: string; label: string; arrived_at: string }[]) ?? []).map((v) => [v.profile_id, v])
  );
  const nameBy = new Map(members.map((m) => [m.id, m.name || m.email || "Unnamed"]));

  const people: TeamLocation[] = onClock.map(([id, ps]) => {
    const shift = shiftState(ps, now);
    const personPings = pingsBy.get(id) ?? [];
    const visit = visitBy.get(id) ?? null;
    const status = liveStatus({ shift, pings: personPings, visitLabel: visit?.label ?? null }, now);
    const latest = personPings[0] ?? null;
    return {
      id,
      name: nameBy.get(id) ?? "Unnamed",
      status,
      lat: latest?.lat ?? null,
      lng: latest?.lng ?? null,
      place: visit?.label ?? null,
      since: visit?.arrived_at ?? null,
      updatedAt: latest?.recorded_at ?? null,
    };
  });
  people.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ people });
}
