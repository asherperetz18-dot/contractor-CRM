import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/cron-env";
import { readTimeClockSettings } from "@/lib/data/time-clock";
import { withRouteObservability } from "@/lib/observability/observe";

/**
 * Time-clock housekeeping, hourly:
 * - a punch open longer than the company's auto clock-out limit is
 *   closed at that limit and marked "auto" (Timesheets flags it), so a
 *   forgotten clock-out doesn't bill the whole night -- and tracking
 *   stops with it;
 * - location trails older than the company's retention are deleted
 *   (the promise in the tracking notice). Hours and arrivals stay.
 */
async function handlePost(req: NextRequest) {
  const cronSecret = getCronSecret();
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: companies } = await admin.from("companies").select("id");
  let closed = 0;
  for (const { id: companyId } of (companies as { id: string }[] | null) ?? []) {
    const settings = await readTimeClockSettings(admin, companyId);
    const limitMs = settings.auto_clock_out_hours * 60 * 60 * 1000;

    const { data: open } = await admin
      .from("time_punches")
      .select("id, profile_id, clock_in")
      .eq("company_id", companyId)
      .is("clock_out", null)
      .lt("clock_in", new Date(Date.now() - limitMs).toISOString());
    for (const p of (open as { id: string; profile_id: string; clock_in: string }[] | null) ?? []) {
      const at = new Date(new Date(p.clock_in).getTime() + limitMs).toISOString();
      await admin.from("time_punches").update({ clock_out: at, end_reason: "auto" }).eq("id", p.id);
      await admin
        .from("site_visits")
        .update({ left_at: at })
        .eq("company_id", companyId)
        .eq("profile_id", p.profile_id)
        .is("left_at", null);
      closed += 1;
    }

    const cutoff = new Date(Date.now() - settings.trail_retention_days * 86_400_000).toISOString();
    await admin.from("location_pings").delete().eq("company_id", companyId).lt("recorded_at", cutoff);
  }
  return NextResponse.json({ companies: companies?.length ?? 0, autoClosed: closed });
}

export const POST = withRouteObservability("api.cron.time-clock", handlePost);
