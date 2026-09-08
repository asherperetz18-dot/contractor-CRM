import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { NwsProvider } from "@/lib/weather-provider";
import { naiveZonedToUtc, nowInZone, parseNaiveDateTime } from "@/lib/timezone";
import { TIMEZONE_IANA, type CompanyProfile } from "@/lib/data/types";

// The rain-check passes, shared between the thrice-daily cron
// (/api/cron/rain-alerts) and the Projects page's on-demand "Check rain
// now" button -- one implementation, so the button can never disagree
// with the cron about what a warning means.

// How far ahead an appointment has to be before it's worth checking --
// matches the design's "48h lookahead" and the cron's own thrice-daily
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

type LeadRow = { id: string; project_type: string | null; address: string | null };

type ProjectRow = {
  id: string;
  lead_id: string;
  status: string;
  kind: string | null;
  parent_estimate_id: string | null;
  completed_on: string | null;
  project_on_hold: boolean | null;
  job_address: string | null;
  rain_alert_sent_at: string | null;
};

export type PassResult = {
  checked: number;
  updated: number;
  /** Highest chance-of-rain seen across everything checked, or null. */
  worstPop: number | null;
};

async function checkAppointments(
  admin: ReturnType<typeof createAdminClient>,
  provider: NwsProvider,
  companyId: string,
  ianaZone: string,
  nowNaive: Date,
  sensitiveNames: Set<string>
): Promise<PassResult> {
  const todayDate = nowNaive.toISOString().slice(0, 10);
  const windowEnd = new Date(nowNaive.getTime() + LOOKAHEAD_HOURS * 3600000);
  const windowEndDate = windowEnd.toISOString().slice(0, 10);

  const { data: candidates } = await admin
    .from("events")
    .select("id, date, time, end_time, status, lead_id, rain_alert_sent_at")
    .eq("company_id", companyId)
    .in("status", ["New", "Confirmed"])
    .not("lead_id", "is", null)
    .gte("date", todayDate)
    .lte("date", windowEndDate);

  const rows = ((candidates ?? []) as EventRow[]).filter((row) => {
    const start = parseNaiveDateTime(row.date, row.time);
    const hoursUntilStart = (start.getTime() - nowNaive.getTime()) / 3600000;
    return hoursUntilStart >= 0 && hoursUntilStart <= LOOKAHEAD_HOURS;
  });
  if (rows.length === 0) return { checked: 0, updated: 0, worstPop: null };

  const leadIds = [...new Set(rows.map((r) => r.lead_id!))];
  const [{ data: leads }, { data: contracts }] = await Promise.all([
    admin.from("leads").select("id, project_type, address").in("id", leadIds),
    admin
      .from("estimates")
      .select("lead_id, job_address")
      .eq("company_id", companyId)
      .eq("kind", "contract")
      .eq("status", "Signed")
      .in("lead_id", leadIds)
      .not("job_address", "is", null),
  ]);
  const leadById = new Map(((leads ?? []) as LeadRow[]).map((l) => [l.id, l]));
  // The winning address per lead: the signed contract's job-site override,
  // if it has one, otherwise the lead's own address. Several leads can
  // share a contract-less state, so this only overrides where a value
  // actually exists.
  const jobAddressByLead = new Map(
    ((contracts ?? []) as { lead_id: string; job_address: string | null }[])
      .filter((c) => c.job_address)
      .map((c) => [c.lead_id, c.job_address as string])
  );

  let updated = 0;
  let worstPop: number | null = null;
  for (const row of rows) {
    const lead = leadById.get(row.lead_id!);
    if (!lead || !lead.project_type || !sensitiveNames.has(lead.project_type)) continue;

    const address = jobAddressByLead.get(lead.id) ?? lead.address;
    if (!address) continue;

    const start = parseNaiveDateTime(row.date, row.time);
    const end = row.end_time
      ? parseNaiveDateTime(row.date, row.end_time)
      : new Date(new Date(row.date + "T00:00:00Z").getTime() + 86400000);

    // start/end are naive local wall-clock values; NWS periods carry real
    // UTC offsets, so convert before comparing -- naive-as-UTC would shift
    // the checked window a whole UTC offset (7-8h for LA) too early.
    const { pop } = await provider.maxRainProbability(
      address,
      naiveZonedToUtc(start, ianaZone).toISOString(),
      naiveZonedToUtc(end, ianaZone).toISOString()
    );
    if (pop === null) continue;

    if (worstPop === null || pop > worstPop) worstPop = pop;
    const patch: { rain_alert_pop: number; rain_alert_sent_at?: string } = {
      rain_alert_pop: Math.round(pop),
    };
    if (pop >= RAIN_THRESHOLD_POP && !row.rain_alert_sent_at) {
      patch.rain_alert_sent_at = new Date().toISOString();
    }
    await admin.from("events").update(patch).eq("id", row.id);
    updated += 1;
  }

  return { checked: rows.length, updated, worstPop };
}

/**
 * Rain on the job itself, not just on appointments: an active outdoor
 * project has crew on site whether or not anything is on the calendar, so
 * each in-progress, weather-sensitive project's site gets its own 48h
 * check. Same window, same threshold, same column pair -- written to the
 * contract row instead of an event row.
 */
async function checkProjects(
  admin: ReturnType<typeof createAdminClient>,
  provider: NwsProvider,
  companyId: string,
  ianaZone: string,
  nowNaive: Date,
  sensitiveNames: Set<string>
): Promise<PassResult> {
  // rain_alert_* arrive with migration 0139; before it has run this select
  // errors, data stays null, and the pass quietly no-ops -- the events
  // pass above is never held hostage by the newest migration.
  const { data: docs } = await admin
    .from("estimates")
    .select(
      "id, lead_id, status, kind, parent_estimate_id, completed_on, project_on_hold, job_address, rain_alert_sent_at"
    )
    .eq("company_id", companyId);
  const all = (docs ?? []) as ProjectRow[];

  // Active projects, by the same rules the Projects page derives status
  // with: signed contracts that aren't completed, on hold, or closed out
  // by a signed completion certificate.
  const completionSigned = new Set(
    all
      .filter((d) => (d.kind ?? "") === "completion" && d.status === "Signed" && d.parent_estimate_id)
      .map((d) => d.parent_estimate_id as string)
  );
  const active = all.filter(
    (d) =>
      (d.kind ?? "contract") === "contract" &&
      d.status === "Signed" &&
      !d.completed_on &&
      !d.project_on_hold &&
      !completionSigned.has(d.id)
  );
  if (active.length === 0) return { checked: 0, updated: 0, worstPop: null };

  const leadIds = [...new Set(active.map((d) => d.lead_id))];
  const { data: leads } = await admin
    .from("leads")
    .select("id, project_type, address")
    .in("id", leadIds);
  const leadById = new Map(((leads ?? []) as LeadRow[]).map((l) => [l.id, l]));

  const fromIso = naiveZonedToUtc(nowNaive, ianaZone).toISOString();
  const toIso = naiveZonedToUtc(
    new Date(nowNaive.getTime() + LOOKAHEAD_HOURS * 3600000),
    ianaZone
  ).toISOString();

  let checked = 0;
  let updated = 0;
  let worstPop: number | null = null;
  for (const project of active) {
    const lead = leadById.get(project.lead_id);
    if (!lead || !lead.project_type || !sensitiveNames.has(lead.project_type)) continue;

    const address = project.job_address ?? lead.address;
    if (!address) continue;

    checked += 1;
    const { pop } = await provider.maxRainProbability(address, fromIso, toIso);
    if (pop === null) continue;

    if (worstPop === null || pop > worstPop) worstPop = pop;
    const patch: { rain_alert_pop: number; rain_alert_sent_at?: string } = {
      rain_alert_pop: Math.round(pop),
    };
    if (pop >= RAIN_THRESHOLD_POP && !project.rain_alert_sent_at) {
      patch.rain_alert_sent_at = new Date().toISOString();
    }
    await admin.from("estimates").update(patch).eq("id", project.id);
    updated += 1;
  }

  return { checked, updated, worstPop };
}

export async function processCompany(
  admin: ReturnType<typeof createAdminClient>,
  userAgent: string,
  company: Pick<CompanyProfile, "company_id" | "timezone">
): Promise<{ events: PassResult; projects: PassResult }> {
  const none: PassResult = { checked: 0, updated: 0, worstPop: null };

  const { data: sensitiveTypes } = await admin
    .from("project_types")
    .select("name")
    .eq("company_id", company.company_id)
    .eq("weather_sensitive", true);
  const sensitiveNames = new Set(((sensitiveTypes ?? []) as { name: string }[]).map((t) => t.name));
  if (sensitiveNames.size === 0) return { events: none, projects: none };

  const ianaZone = TIMEZONE_IANA[company.timezone] ?? "America/Los_Angeles";
  const nowNaive = nowInZone(ianaZone);
  // One provider for both passes, so an appointment and a project at the
  // same gridpoint share a single NWS forecast fetch.
  const provider = new NwsProvider(userAgent, admin);

  const events = await checkAppointments(
    admin, provider, company.company_id, ianaZone, nowNaive, sensitiveNames
  );
  const projects = await checkProjects(
    admin, provider, company.company_id, ianaZone, nowNaive, sensitiveNames
  );
  return { events, projects };
}
