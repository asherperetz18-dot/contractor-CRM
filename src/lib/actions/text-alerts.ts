"use server";

import { clientName } from "@/lib/data/client-name";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import { canSeePage, type RolePageVisibilityRow } from "@/lib/data/types";
import {
  TEXT_ALERT_WINDOW_DAYS,
  coerceTextAlertRollup,
  rollupTextAlerts,
  type FreshText,
  type TextAlertRow,
} from "@/lib/data/text-alert-rollup";

export type { FreshText };

/**
 * What the incoming-text watcher polls: how many conversations are
 * waiting on us, and which inbound texts are new since the caller last
 * looked.
 *
 * "Waiting on us" means the customer spoke last -- the same grouping the
 * Reply Inbox draws, so the badge and the page can never disagree about
 * what needs attention. Replying is what clears it; there is no separate
 * read-tracking to maintain or forget.
 *
 * Scoped to the last 30 days: a thread silent for a month is not an
 * alert, it is history, and counting it forever would teach everyone to
 * ignore the badge.
 *
 * Reduced in the database (text_alert_rollup, migration 0168): every
 * open tab asks this every 20 seconds, and the answer used to be the
 * whole 30-day window walked out of Postgres in 1000-row pages per ask.
 * Until that migration is run, the fallback below walks the window as
 * before through the same tested reduction -- slower, same numbers.
 */
export async function getTextAlerts(sinceIso: string | null): Promise<{
  error?: string;
  awaitingCount?: number;
  latestIso?: string | null;
  fresh?: FreshText[];
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();

  // The component only mounts for roles that can see the Reply Inbox,
  // but a server action is reachable directly -- so the same gate is
  // checked here, against the same visibility matrix.
  const { data: visibilityRows } = await supabase
    .from("role_page_visibility")
    .select("id, role, page_key, visible")
    .eq("company_id", profile.company_id);
  if (!canSeePage(profile, "reply-inbox", (visibilityRows as RolePageVisibilityRow[]) ?? [])) {
    return { awaitingCount: 0, latestIso: sinceIso, fresh: [] };
  }

  const windowStart = new Date(Date.now() - TEXT_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: reduced, error: rpcError } = await supabase.rpc("text_alert_rollup", {
    p_company: profile.company_id,
    p_since: sinceIso,
    p_window_start: windowStart,
  });
  if (!rpcError && reduced) {
    const rollup = coerceTextAlertRollup(reduced);
    if (rollup) {
      return {
        awaitingCount: rollup.awaitingCount,
        latestIso: rollup.latestIso ?? sinceIso,
        // A lead the caller's RLS hides, or none at all: the number is
        // the name, as the inbox shows it.
        fresh: rollup.fresh.map((f) => ({ ...f, name: f.name || f.fromNumber })),
      };
    }
  }

  // ── Fallback: the window walked out and reduced here ────────────
  // selectAll, not .limit(): PostgREST silently clamps any limit to the
  // project's max-rows (1000 here), and a clamped newest-first list
  // makes whole conversations vanish from the count -- not misfiled,
  // just never seen. The 30-day window keeps the walk bounded.
  const rows = await selectAll<TextAlertRow>((f, t) =>
    supabase
      .from("sms_messages")
      .select("id, lead_id, direction, from_number, to_number, body, created_at")
      .eq("company_id", profile.company_id)
      // Same exclusion the Reply Inbox applies: rep-facing texts are not
      // customer conversations, except a crew reply tied to nothing.
      .or("channel.neq.rep,and(channel.eq.rep,lead_id.is.null,direction.eq.inbound)")
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false })
      .range(f, t)
  );

  const { awaitingCount, latestIso, fresh: freshRows } = rollupTextAlerts(rows, sinceIso);

  const leadIds = [...new Set(freshRows.map((m) => m.leadId).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (leadIds.length) {
    const { data: leads } = await supabase
      .from("leads")
      .select("id, contact_type, first_name, last_name, company_name")
      .in("id", leadIds);
    for (const l of (leads as {
      id: string;
      contact_type: string | null;
      first_name: string | null;
      last_name: string | null;
      company_name: string | null;
    }[]) ?? []) {
      names.set(
        l.id,
        clientName(l)
      );
    }
  }

  const fresh: FreshText[] = freshRows.map((m) => ({
    ...m,
    name: (m.leadId && names.get(m.leadId)) || m.fromNumber,
  }));

  return { awaitingCount, latestIso, fresh };
}
