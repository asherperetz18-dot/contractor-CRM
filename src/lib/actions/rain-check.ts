"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { getWeatherUserAgent } from "@/lib/weather-env";
import { processCompany } from "@/lib/rain-alerts-core";
import { isAdminRole, type CompanyProfile } from "@/lib/data/types";

export type RainCheckResult = {
  error?: string;
  /** Job sites checked (active weather-sensitive projects). */
  projectsChecked?: number;
  /** Upcoming appointments checked. */
  appointmentsChecked?: number;
  /** Highest chance-of-rain seen anywhere in the check, or null. */
  worstPop?: number | null;
};

/**
 * The Projects page's "Check rain now" button: runs the exact passes the
 * thrice-daily cron runs -- same code, imported from rain-alerts-core --
 * but for the caller's company only, so fresh badges are a click away
 * when the sky turns instead of hours away.
 */
export async function checkRainNow(): Promise<RainCheckResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  // Office/Admin only -- the same people the rain popup targets; the
  // button doesn't render for anyone else, and this backstops that.
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can run a rain check." };

  const userAgent = getWeatherUserAgent();
  if (!userAgent) return { error: "Weather checks aren't configured (WEATHER_USER_AGENT)." };

  const admin = createAdminClient();
  const { data: company } = await admin
    .from("company_profile")
    .select("company_id, timezone")
    .eq("company_id", profile.company_id)
    .maybeSingle();
  if (!company) return { error: "Company profile not found." };

  const result = await processCompany(
    admin,
    userAgent,
    company as Pick<CompanyProfile, "company_id" | "timezone">
  );

  const pops = [result.events.worstPop, result.projects.worstPop].filter(
    (p): p is number => p !== null
  );
  return {
    projectsChecked: result.projects.checked,
    appointmentsChecked: result.events.checked,
    worstPop: pops.length ? Math.max(...pops) : null,
  };
}
