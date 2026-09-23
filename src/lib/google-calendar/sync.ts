import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/data/select-all";
import { zoneForCompany } from "@/lib/data/company-today";
import { addDays, isoDateInZone } from "@/lib/company-clock";
import { portalBaseUrl } from "@/lib/portal/session";
import {
  accessTokenFor,
  deleteEvent,
  insertEvent,
  listChanges,
  patchEvent,
  type ConnectionRow,
} from "./client";
import {
  decidePull,
  googleEventBody,
  planPush,
  type SyncEvent,
  type SyncLead,
  type SyncLink,
} from "./sync-plan";

/**
 * One sync of one connection: pull what changed in Google, then push
 * what changed in the CRM. Run by the cron every 15 minutes and by the
 * "Sync now" button. Every decision comes from sync-plan.ts; this file
 * only reads, calls Google, and writes what was decided.
 *
 * Bounded on purpose: a run creates at most WRITE_CAP Google events, so
 * a rep connecting with a year of history doesn't tie up a cron slot --
 * the rest catch up on the next runs. Appointments are pushed from a
 * week back; older unlinked ones are history and stay in the CRM only.
 */

const WRITE_CAP = 150;
const PUSH_LOOKBACK_DAYS = 7;
const PULL_LOOKBACK_DAYS = 30;

type Admin = ReturnType<typeof createAdminClient>;

export type SyncSummary = {
  created: number;
  updated: number;
  removed: number;
  pulled: number;
  error: string | null;
};

const EVENT_COLUMNS =
  "id, title, date, time, end_time, event_type, status, assigned_to, second_assigned_to, notes, updated_at, leads (contact_type, company_name, first_name, last_name, phone, address)";

type EventRaw = Omit<SyncEvent, "lead"> & { leads: SyncLead | SyncLead[] | null };

function toSyncEvent(r: EventRaw): SyncEvent {
  const { leads, ...rest } = r;
  const lead = Array.isArray(leads) ? (leads[0] ?? null) : leads;
  return { ...rest, lead };
}

type LinkRow = SyncLink & { id: string; connection_id: string };

async function loadLinks(admin: Admin, connectionId: string): Promise<LinkRow[]> {
  return selectAll<LinkRow>((from, to) =>
    admin
      .from("google_calendar_links")
      .select("id, connection_id, event_id, google_event_id, google_etag, crm_updated_at")
      .eq("connection_id", connectionId)
      .order("id")
      .range(from, to)
  );
}

async function loadEventsById(admin: Admin, ids: string[]): Promise<Map<string, SyncEvent>> {
  const out = new Map<string, SyncEvent>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin
      .from("events")
      .select(EVENT_COLUMNS)
      .in("id", ids.slice(i, i + 200));
    for (const r of (data as EventRaw[] | null) ?? []) out.set(r.id, toSyncEvent(r));
  }
  return out;
}

/** Google → CRM. Only times and cancellations travel this way. */
async function pull(
  admin: Admin,
  conn: ConnectionRow,
  token: string,
  zone: string,
  links: LinkRow[],
  summary: SyncSummary
): Promise<void> {
  const timeMin = new Date(Date.now() - PULL_LOOKBACK_DAYS * 86_400_000).toISOString();
  let result = await listChanges(token, conn.google_calendar_id, { syncToken: conn.sync_token, timeMin });
  if (!result.ok && result.gone) {
    // Stale cursor: Google asks for a full read. Nothing is lost -- the
    // etags on the links still tell our writes from theirs.
    result = await listChanges(token, conn.google_calendar_id, { syncToken: null, timeMin });
  }
  if (!result.ok) {
    summary.error = `Google wouldn't list changes (${result.status}).`;
    return;
  }

  const byGoogleId = new Map(links.map((l) => [l.google_event_id, l]));
  const touched = result.items.filter((g) => byGoogleId.has(g.id));
  const events = await loadEventsById(
    admin,
    touched.map((g) => byGoogleId.get(g.id)!.event_id)
  );

  for (const g of touched) {
    const link = byGoogleId.get(g.id)!;
    const e = events.get(link.event_id) ?? null;
    const decision = decidePull(g, link, e, zone);
    if (decision.kind === "skip") continue;

    const patch =
      decision.kind === "cancel"
        ? { status: "Cancelled" }
        : {
            date: decision.date,
            time: decision.time,
            end_time: decision.end_time,
            // A moved appointment is a new occurrence (rescheduleResets in
            // actions/events.ts): the reminders and the rain check start over.
            result_reminder_sent_at: null,
            followup_flagged_at: null,
            followup_moved_at: null,
            rain_alert_sent_at: null,
            rain_alert_pop: null,
          };
    const { data } = await admin
      .from("events")
      .update(patch)
      .eq("id", link.event_id)
      .select("updated_at")
      .maybeSingle<{ updated_at: string }>();
    if (!data) continue;
    summary.pulled += 1;
    // Stamp the link with the row's new updated_at, so the push that
    // follows does not read this write as a CRM change to send back.
    await admin
      .from("google_calendar_links")
      .update({
        crm_updated_at: data.updated_at,
        google_etag: g.etag ?? link.google_etag,
        google_updated: g.updated ?? null,
        synced_at: new Date().toISOString(),
      })
      .eq("id", link.id);
    link.crm_updated_at = data.updated_at;
    link.google_etag = g.etag ?? link.google_etag;
  }

  if (result.nextSyncToken && result.nextSyncToken !== conn.sync_token) {
    await admin
      .from("google_calendar_connections")
      .update({ sync_token: result.nextSyncToken })
      .eq("id", conn.id);
  }
}

/** CRM → Google. */
async function push(
  admin: Admin,
  conn: ConnectionRow,
  token: string,
  zone: string,
  links: LinkRow[],
  summary: SyncSummary
): Promise<void> {
  const windowStart = addDays(isoDateInZone(new Date(), zone), -PUSH_LOOKBACK_DAYS);
  const scope = { profile_id: conn.profile_id };

  const inScope = await selectAll<EventRaw>((from, to) => {
    let q = admin
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("company_id", conn.company_id)
      .gte("date", windowStart)
      .order("date")
      .order("id")
      .range(from, to);
    if (conn.profile_id) {
      q = q.or(`assigned_to.eq.${conn.profile_id},second_assigned_to.eq.${conn.profile_id}`);
    }
    return q;
  });
  const events = new Map(inScope.map((r) => [r.id, toSyncEvent(r)]));
  const missing = links.map((l) => l.event_id).filter((id) => !events.has(id));
  for (const [id, e] of await loadEventsById(admin, missing)) events.set(id, e);

  const plan = planPush(Array.from(events.values()), links, scope, windowStart);
  const crmUrl = portalBaseUrl();
  let writes = 0;
  const now = () => new Date().toISOString();

  for (const l of plan.removes) {
    if (writes++ >= WRITE_CAP) return;
    const res = await deleteEvent(token, conn.google_calendar_id, l.google_event_id);
    if (!res.ok) {
      summary.error = `Google wouldn't remove an event (${res.status}).`;
      continue;
    }
    await admin.from("google_calendar_links").delete().eq("id", l.id);
    summary.removed += 1;
  }

  for (const { event, link } of plan.updates) {
    if (writes++ >= WRITE_CAP) return;
    const res = await patchEvent(token, conn.google_calendar_id, link.google_event_id, googleEventBody(event, zone, crmUrl));
    if (!res.ok) {
      if (res.status === 404 || res.status === 410) {
        // Deleted on the Google side without us seeing it: drop the link
        // and let the next run create it afresh if it is still wanted.
        await admin.from("google_calendar_links").delete().eq("id", link.id);
      } else {
        summary.error = res.message;
      }
      continue;
    }
    await admin
      .from("google_calendar_links")
      .update({
        google_etag: res.event.etag ?? null,
        google_updated: res.event.updated ?? null,
        crm_updated_at: event.updated_at,
        synced_at: now(),
      })
      .eq("id", link.id);
    summary.updated += 1;
  }

  for (const event of plan.creates) {
    if (writes++ >= WRITE_CAP) return;
    const res = await insertEvent(token, conn.google_calendar_id, googleEventBody(event, zone, crmUrl));
    if (!res.ok) {
      summary.error = res.message;
      continue;
    }
    await admin.from("google_calendar_links").upsert(
      {
        connection_id: conn.id,
        event_id: event.id,
        google_event_id: res.event.id,
        google_etag: res.event.etag ?? null,
        google_updated: res.event.updated ?? null,
        crm_updated_at: event.updated_at,
        synced_at: now(),
      },
      { onConflict: "connection_id,event_id" }
    );
    summary.created += 1;
  }
}

/** Pull, then push, then record how it went on the connection row. */
export async function syncConnection(admin: Admin, conn: ConnectionRow): Promise<SyncSummary> {
  const summary: SyncSummary = { created: 0, updated: 0, removed: 0, pulled: 0, error: null };
  const token = await accessTokenFor(admin, conn);
  if (!token) {
    summary.error = "Google no longer accepts this connection — reconnect it.";
  } else {
    const zone = await zoneForCompany(admin, conn.company_id);
    const links = await loadLinks(admin, conn.id);
    try {
      await pull(admin, conn, token, zone, links, summary);
      await push(admin, conn, token, zone, links, summary);
    } catch (err) {
      summary.error = err instanceof Error ? err.message : "Sync failed.";
    }
  }
  await admin
    .from("google_calendar_connections")
    .update({ last_synced_at: new Date().toISOString(), last_error: summary.error })
    .eq("id", conn.id);
  return summary;
}

/** Every connection on the platform, for the cron. */
export async function listConnections(admin: Admin): Promise<ConnectionRow[]> {
  const { data, error } = await admin.from("google_calendar_connections").select("*").order("connected_at");
  if (error) return [];
  return (data as ConnectionRow[] | null) ?? [];
}
