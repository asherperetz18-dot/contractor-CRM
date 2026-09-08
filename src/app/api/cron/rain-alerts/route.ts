import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/cron-env";
import { getWeatherUserAgent } from "@/lib/weather-env";
import { NwsProvider } from "@/lib/weather-provider";
import { nowInZone, parseNaiveDateTime } from "@/lib/timezone";
import { TIMEZONE_IANA, type CompanyProfile } from "@/lib/data/types";

// How far ahead an appointment has to be before it's worth checking --
// matches the design's "48h lookahead" and this cron's own thrice-daily
// cadence (checking further out would just re-report a forecast that's
// still likely to change).
const LOOKAHEAD_HOURS = 48;
const RAIN_THRESHOLD_POP = 50;

type EventRow = {
  id: string;
  date: string;
  time: string | null;
  end_time: string | null;
  status: string;
  lead_id: string | null;
  rain_alert_sent_at: string | null;
};

async function processCompany(
  admin: ReturnType<typeof createAdminClient>,
  userAgent: string,
  company: Pick<CompanyProfile, "company_id" | "timezone">
): Promise<{ checked: number; updated: number }> {
  const { data: sensitiveTypes } = await admin
    .from("project_types")
    .select("name")
    .eq("company_id", company.company_id)
    .eq("weather_sensitive", true);
  const sensitiveNames = new Set(((sensitiveTypes ?? []) as { name: string }[]).map((t) => t.name));
  if (sensitiveNames.size === 0) return { checked: 0, updated: 0 };

  const ianaZone = TIMEZONE_IANA[company.timezone] ?? "America/Los_Angeles";
  const nowNaive = nowInZone(ianaZone);
  const todayDate = nowNaive.toISOString().slice(0, 10);
  const windowEnd = new Date(nowNaive.getTime() + LOOKAHEAD_HOURS * 3600000);
  const windowEndDate = windowEnd.toISOString().slice(0, 10);

  const { data: candidates } = await admin
    .from("events")
    .select("id, date, time, end_time, status, lead_id, rain_alert_sent_at")
    .eq("company_id", company.company_id)
    .in("status", ["New", "Confirmed"])
    .not("lead_id", "is", null)
    .gte("date", todayDate)
    .lte("date", windowEndDate);

  const rows = ((candidates ?? []) as EventRow[]).filter((row) => {
    const start = parseNaiveDateTime(row.date, row.time);
    const hoursUntilStart = (start.getTime() - nowNaive.getTime()) / 3600000;
    return hoursUntilStart >= 0 && hoursUntilStart <= LOOKAHEAD_HOURS;
  });
  if (rows.length === 0) return { checked: 0, updated: 0 };

  const leadIds = [...new Set(rows.map((r) => r.lead_id!))];
  const [{ data: leads }, { data: contracts }] = await Promise.all([
    admin.from("leads").select("id, project_type, address").in("id", leadIds),
    admin
      .from("estimates")
      .select("lead_id, job_address")
      .eq("company_id", company.company_id)
      .eq("kind", "contract")
      .eq("status", "Signed")
      .in("lead_id", leadIds)
      .not("job_address", "is", null),
  ]);
  const leadById = new Map(
    ((leads ?? []) as { id: string; project_type: string | null; address: string | null }[]).map((l) => [
      l.id,
      l,
    ])
  );
  // The winning address per lead: the signed contract's job-site override,
  // if it has one, otherwise the lead's own address. Several leads can
  // share a contract-less state, so this only overrides where a value
  // actually exists.
  const jobAddressByLead = new Map(
    ((contracts ?? []) as { lead_id: string; job_address: string | null }[])
      .filter((c) => c.job_address)
      .map((c) => [c.lead_id, c.job_address as string])
  );

  const provider = new NwsProvider(userAgent, admin);
  let updated = 0;
  for (const row of rows) {
    const lead = leadById.get(row.lead_id!);
    if (!lead || !lead.project_type || !sensitiveNames.has(lead.project_type)) continue;

    const address = jobAddressByLead.get(lead.id) ?? lead.address;
    if (!address) continue;

    const start = parseNaiveDateTime(row.date, row.time);
    const end = row.end_time
      ? parseNaiveDateTime(row.date, row.end_time)
      : new Date(new Date(row.date + "T00:00:00Z").getTime() + 86400000);

    const { pop } = await provider.maxRainProbability(address, start.toISOString(), end.toISOString());
    if (pop === null) continue;

    const patch: { rain_alert_pop: number; rain_alert_sent_at?: string } = {
      rain_alert_pop: Math.round(pop),
    };
    if (pop >= RAIN_THRESHOLD_POP && !row.rain_alert_sent_at) {
      patch.rain_alert_sent_at = new Date().toISOString();
    }
    await admin.from("events").update(patch).eq("id", row.id);
    updated += 1;
  }

  return { checked: rows.length, updated };
}

export async function POST(req: NextRequest) {
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userAgent = getWeatherUserAgent();
  if (!userAgent) {
    return NextResponse.json({ error: "WEATHER_USER_AGENT not configured" }, { status: 500 });
  }

  const admin = createAdminClient();
  const { data: companies } = await admin.from("company_profile").select("company_id, timezone");
  const companyRows = (companies as Pick<CompanyProfile, "company_id" | "timezone">[] | null) ?? [];

  let checked = 0;
  let updated = 0;
  for (const company of companyRows) {
    const result = await processCompany(admin, userAgent, company);
    checked += result.checked;
    updated += result.updated;
  }

  return NextResponse.json({ companies: companyRows.length, checked, updated });
}
