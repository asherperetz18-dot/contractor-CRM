import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronSecret } from "@/lib/cron-env";
import { getWeatherUserAgent } from "@/lib/weather-env";
import { processCompany } from "@/lib/rain-alerts-core";
import { type CompanyProfile } from "@/lib/data/types";
import { withRouteObservability } from "@/lib/observability/observe";

// Thin scheduled wrapper: the actual appointment + project rain passes
// live in rain-alerts-core, shared with the Projects page's "Check rain
// now" button.

async function handlePost(req: NextRequest) {
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
  let projectsChecked = 0;
  let projectsUpdated = 0;
  for (const company of companyRows) {
    const result = await processCompany(admin, userAgent, company);
    checked += result.events.checked;
    updated += result.events.updated;
    projectsChecked += result.projects.checked;
    projectsUpdated += result.projects.updated;
  }

  return NextResponse.json({
    companies: companyRows.length,
    checked,
    updated,
    projectsChecked,
    projectsUpdated,
  });
}

// Observability rollout (TECH_DEBT -> DECISIONS #031): timing, correlation
// id, and Sentry capture for every run, same wrapper as the dialer path.
export const POST = withRouteObservability("api.cron.rain-alerts", handlePost);
