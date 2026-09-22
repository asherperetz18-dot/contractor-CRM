import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentCompanyId } from "@/lib/data/profile";
import { companyIanaZone } from "@/lib/data/types";
import { isoDateInZone, localClockIn } from "@/lib/company-clock";

/**
 * "What day is it?" answered on the company's own clock.
 *
 * The server runs in UTC, so anything that sliced `new Date()` to a date
 * was a day ahead of the office from 5pm Pacific on. Pages and actions
 * with a signed-in user ask `companyToday()`; webhooks, the portal and
 * anything else holding only a company id ask `todayForCompany()`. The
 * date math itself is in lib/company-clock (pure, tested); this file only
 * knows which company is asking.
 */

type Client = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

/** The IANA zone behind `companyId`'s profile, read with `client`. */
export async function zoneForCompany(client: Client, companyId: string): Promise<string> {
  const { data } = await client
    .from("company_profile")
    .select("timezone")
    .eq("company_id", companyId)
    .maybeSingle<{ timezone: string | null }>();
  return companyIanaZone(data?.timezone);
}

/** Today's YYYY-MM-DD for a company, for code without a signed-in user. */
export async function todayForCompany(client: Client, companyId: string): Promise<string> {
  return isoDateInZone(new Date(), await zoneForCompany(client, companyId));
}

/** The current company's zone, fetched at most once per request. */
export const getCompanyZone = cache(async (): Promise<string> => {
  const companyId = await getCurrentCompanyId();
  if (!companyId) return companyIanaZone(null);
  return zoneForCompany(await createClient(), companyId);
});

/** Today's YYYY-MM-DD in the current company's zone. */
export async function companyToday(): Promise<string> {
  return isoDateInZone(new Date(), await getCompanyZone());
}

/**
 * "Now" as a Date whose local getters read the company's wall clock, for
 * the date-range helpers (`presetWindow`, `resolveWindow`, `isoDay`) and
 * any week/month arithmetic written against local time. A calendar, not
 * an instant: keep a real `new Date()` for anything measured in hours.
 */
export async function companyNow(): Promise<Date> {
  return localClockIn(new Date(), await getCompanyZone());
}
