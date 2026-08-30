"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isStrictAdmin, type ActivityEvent } from "@/lib/data/types";

const PAGE_SIZE = 1000; // the project's PostgREST max-rows
const BATCH = 6; // pages fetched at once
const HARD_CAP = 60000;

/**
 * Activity events for one window, for the Team Activity report.
 *
 * The page used to load ninety days of raw events on every visit --
 * 26,705 rows, 3.4MB of them -- and then let the browser narrow that to
 * whatever range was selected. It opens on "today", which is about
 * 1,800 events, so roughly fourteen fifteenths of what it fetched was
 * thrown away before anything was drawn. Fetching the window that is
 * actually being shown is the whole change; the report's arithmetic is
 * untouched.
 *
 * Pages are fetched several at a time rather than one after another.
 * The old loop awaited each page before asking for the next, so ninety
 * days meant twenty round trips in a row while the response streamed.
 *
 * Reads through the service role and gates on isStrictAdmin first,
 * exactly as the lead-view range query beside it does: this is every
 * teammate's browsing history and there is no reason to fetch it for
 * somebody who may not see it.
 */
export async function getActivityEventsInRange(
  sinceISO: string,
  untilISO?: string
): Promise<{ error?: string; events?: ActivityEvent[]; truncated?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isStrictAdmin(profile)) return { error: "Admin access required." };

  const supabase = createAdminClient();
  const page = (from: number) => {
    let q = supabase
      .from("activity_events")
      .select("id, user_id, session_id, path, kind, created_at")
      .eq("company_id", profile.company_id)
      .gte("created_at", sinceISO);
    if (untilISO) q = q.lte("created_at", untilISO);
    // Newest first, so if the cap below is ever reached it is old data
    // that is missing rather than today's.
    return q.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  };

  const rows: ActivityEvent[] = [];
  let from = 0;
  let truncated = false;

  while (from < HARD_CAP) {
    const pages = await Promise.all(
      Array.from({ length: BATCH }, (_, i) => page(from + i * PAGE_SIZE))
    );
    let done = false;
    for (const { data, error } of pages) {
      if (error) return { error: error.message };
      const got = (data ?? []) as ActivityEvent[];
      rows.push(...got);
      if (got.length < PAGE_SIZE) {
        done = true;
        break;
      }
    }
    if (done) break;
    from += BATCH * PAGE_SIZE;
    if (from >= HARD_CAP) truncated = true;
  }

  // Said out loud rather than left for the reader to notice. The old cap
  // was 20,000 against 26,705 rows in ninety days, so the "90 days"
  // report was quietly showing about sixty-seven of them.
  return { events: rows, truncated };
}
