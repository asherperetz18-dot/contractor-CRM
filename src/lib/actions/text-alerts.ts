"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import {
  canSeePage,
  normalizePhone,
  type RolePageVisibilityRow,
} from "@/lib/data/types";

/** One toast's worth of a new incoming text. */
export type FreshText = {
  id: string;
  leadId: string | null;
  /** The sender's number -- the inbox deep-links by it when the text
   *  matched no lead. */
  fromNumber: string;
  /** Who it's from: the lead's name, or the bare number. */
  name: string;
  preview: string;
  at: string;
};

type AlertRow = {
  id: string;
  lead_id: string | null;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  body: string | null;
  created_at: string;
};

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

  const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  // selectAll, not .limit(): PostgREST silently clamps any limit to the
  // project's max-rows (1000 here), and a clamped newest-first list
  // makes whole conversations vanish from the count -- not misfiled,
  // just never seen. The 30-day window keeps the walk bounded.
  const rows = await selectAll<AlertRow>((f, t) =>
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

  // Newest message per conversation, keyed the way the inbox keys them.
  // Rows arrive newest-first, so the first row seen for a key IS the
  // newest -- a conversation is "awaiting" when that row is inbound.
  const newestByKey = new Map<string, AlertRow>();
  for (const m of rows) {
    const counterparty = m.direction === "inbound" ? m.from_number : m.to_number;
    const key = m.lead_id ?? `phone:${normalizePhone(counterparty)}`;
    if (!newestByKey.has(key)) newestByKey.set(key, m);
  }
  const awaitingCount = [...newestByKey.values()].filter(
    (m) => m.direction === "inbound"
  ).length;

  const latestIso = rows[0]?.created_at ?? sinceIso;

  // The toasts: inbound texts the caller has not seen yet. Capped so a
  // burst becomes a badge, not a wall of pop-ups.
  const freshRows = sinceIso
    ? rows.filter((m) => m.direction === "inbound" && m.created_at > sinceIso).slice(0, 5)
    : [];

  const leadIds = [...new Set(freshRows.map((m) => m.lead_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (leadIds.length) {
    const { data: leads } = await supabase
      .from("leads")
      .select("id, first_name, last_name, company_name")
      .in("id", leadIds);
    for (const l of (leads as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      company_name: string | null;
    }[]) ?? []) {
      names.set(
        l.id,
        [l.first_name, l.last_name].filter(Boolean).join(" ") || l.company_name || ""
      );
    }
  }

  const fresh: FreshText[] = freshRows.map((m) => ({
    id: m.id,
    leadId: m.lead_id,
    fromNumber: m.from_number,
    name: (m.lead_id && names.get(m.lead_id)) || m.from_number,
    preview: (m.body ?? "").slice(0, 90),
    at: m.created_at,
  }));

  return { awaitingCount, latestIso, fresh };
}
