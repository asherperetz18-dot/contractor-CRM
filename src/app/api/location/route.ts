import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { zoneForCompany } from "@/lib/data/company-today";
import { closeOpenVisit, readTimeClockSettings, visitKey, zonesForToday } from "@/lib/data/time-clock";
import { nearestZone, nextVisitStep } from "@/lib/time-clock/geo";

/**
 * The phone's location while its owner is on the clock.
 *
 * GET  -> { tracking } : should this device be sending fixes right now?
 * POST -> one fix. Stored as a ping (RLS refuses it unless the sender
 *         has an open punch), then checked against today's job zones to
 *         open or close a site visit. Visits are written with the
 *         service role: nobody writes their own attendance.
 *
 * A thin route, not a Server Action, because the sharer calls it on a
 * timer (DECISIONS #029, #062).
 */

async function openPunchExists(companyId: string, profileId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("time_punches")
    .select("id")
    .eq("company_id", companyId)
    .eq("profile_id", profileId)
    .is("clock_out", null)
    .limit(1);
  return !!data?.length;
}

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ tracking: false });
  return NextResponse.json({ tracking: await openPunchExists(profile.company_id, profile.id) });
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ tracking: false }, { status: 401 });

  let body: { lat?: unknown; lng?: unknown; accuracy?: unknown; recordedAt?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const accuracy = body.accuracy == null ? null : Number(body.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Bad location" }, { status: 400 });
  }
  const recorded = typeof body.recordedAt === "string" ? new Date(body.recordedAt) : new Date();
  const recordedAt = Number.isNaN(recorded.getTime()) ? new Date().toISOString() : recorded.toISOString();

  const supabase = await createClient();
  const { error } = await supabase.from("location_pings").insert({
    company_id: profile.company_id,
    profile_id: profile.id,
    recorded_at: recordedAt,
    lat,
    lng,
    accuracy_m: Number.isFinite(accuracy) ? accuracy : null,
  });
  // Refused = off the clock (or a stale fix): tell the phone to stop.
  if (error) return NextResponse.json({ tracking: false });

  const admin = createAdminClient();
  const [settings, zone] = await Promise.all([
    readTimeClockSettings(admin, profile.company_id),
    zoneForCompany(admin, profile.company_id),
  ]);
  const zones = await zonesForToday(admin, profile.company_id, profile.id, zone, settings);
  const hit = nearestZone({ lat, lng, accuracy }, zones, settings.zone_radius_m);

  const { data: open } = await admin
    .from("site_visits")
    .select("id, event_id")
    .eq("company_id", profile.company_id)
    .eq("profile_id", profile.id)
    .is("left_at", null)
    .maybeSingle<{ id: string; event_id: string | null }>();
  const step = nextVisitStep(open ? visitKey(open) : null, hit?.zone ?? null);
  if (step.close) await closeOpenVisit(admin, profile.company_id, profile.id, recordedAt);
  if (step.open) {
    await admin.from("site_visits").insert({
      company_id: profile.company_id,
      profile_id: profile.id,
      event_id: step.open.eventId,
      label: step.open.label,
      arrived_at: recordedAt,
      distance_m: hit ? Math.round(hit.distance) : null,
    });
  }
  return NextResponse.json({ tracking: true, at: hit?.zone.label ?? null });
}
