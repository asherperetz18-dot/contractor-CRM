/**
 * The pure half of Google Calendar sync: what a CRM appointment looks
 * like as a Google event, what a Google event means in CRM terms, and
 * which way each change flows. No Supabase, no fetch -- node:test can
 * reach all of it, and the runner in ./sync.ts only executes what this
 * file decides.
 *
 * The rules, in one place:
 *  - The CRM is where appointments are made. Google is a mirror the rep
 *    (or the office) can move or cancel from; Google-native events are
 *    never imported.
 *  - Push: a live appointment the connection wants gets created or
 *    updated; a dead one (Cancelled / No-show), a deleted one, or one no
 *    longer assigned to this rep is removed from Google.
 *  - Pull: only the times and a cancellation come back. When both sides
 *    changed since the last sync, the later edit wins.
 */
import { addDays, instantOfWallClock, wallClockIn } from "../company-clock.ts";
import { leadDisplayName, mapsUrl, type ContactType } from "../data/types.ts";

export type SyncLead = {
  contact_type: ContactType;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  address: string | null;
};

export type SyncEvent = {
  id: string;
  title: string | null;
  date: string;
  time: string | null;
  end_time: string | null;
  event_type: string;
  status: string;
  assigned_to: string | null;
  second_assigned_to: string | null;
  notes: string | null;
  updated_at: string;
  lead: SyncLead | null;
};

export type SyncLink = {
  event_id: string;
  google_event_id: string;
  /** Google's etag from our last write or read -- an item echoing it back is our own change. */
  google_etag: string | null;
  /** events.updated_at at the last sync in either direction. */
  crm_updated_at: string | null;
};

export type ConnectionScope = {
  /** Null is the company-wide calendar: every appointment. */
  profile_id: string | null;
};

export type GoogleEventTime = { date?: string; dateTime?: string; timeZone?: string };

export type GoogleEvent = {
  id: string;
  etag?: string;
  status?: string;
  updated?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  summary?: string;
};

export type GoogleEventBody = {
  summary: string;
  description: string;
  location?: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
  extendedProperties: { private: { crm_event_id: string } };
  reminders: { useDefault: true };
};

/** Cancelled and No-show appointments come off Google; the rest stay. */
export const DEAD_STATUSES = new Set(["Cancelled", "No-show"]);

const DEFAULT_MINUTES = 60;

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

function instantOf(date: string, time: string, zone: string): Date {
  return instantOfWallClock(new Date(`${date}T${time.slice(0, 5)}:00.000Z`), zone);
}

/** Whether this connection should carry the appointment at all. */
export function eventWanted(e: SyncEvent, scope: ConnectionScope): boolean {
  if (DEAD_STATUSES.has(e.status)) return false;
  if (scope.profile_id === null) return true;
  return e.assigned_to === scope.profile_id || e.second_assigned_to === scope.profile_id;
}

export function googleEventBody(e: SyncEvent, zone: string, crmBaseUrl: string): GoogleEventBody {
  const who = e.lead ? leadDisplayName(e.lead) : "";
  const summary = [e.event_type, who].filter(Boolean).join(": ") + (e.title ? ` — ${e.title}` : "");

  const lines: string[] = [];
  if (e.lead?.phone) lines.push(`📞 ${e.lead.phone}`);
  if (e.lead?.address) lines.push(`📍 ${e.lead.address}\n${mapsUrl(e.lead.address)}`);
  if (e.notes) lines.push(`Notes: ${e.notes}`);
  lines.push(`Status: ${e.status}`);
  lines.push(`Open in CRM: ${crmBaseUrl}/calendar?openEvent=${encodeURIComponent(e.id)}`);
  lines.push("Synced from Contractor CRM. Move or cancel it here and the CRM follows; other edits stay in the CRM.");

  const base = {
    summary,
    description: lines.join("\n\n"),
    ...(e.lead?.address ? { location: e.lead.address } : {}),
    extendedProperties: { private: { crm_event_id: e.id } },
    reminders: { useDefault: true as const },
  };

  if (!e.time) {
    return { ...base, start: { date: e.date }, end: { date: addDays(e.date, 1) } };
  }
  const start = instantOf(e.date, e.time, zone);
  const end = e.end_time
    ? instantOf(e.date, e.end_time, zone)
    : new Date(start.getTime() + DEFAULT_MINUTES * 60_000);
  // An end at or before the start is a zero-length slot the form allowed;
  // Google rejects it, so give it the default length instead.
  const safeEnd = end.getTime() > start.getTime() ? end : new Date(start.getTime() + DEFAULT_MINUTES * 60_000);
  return {
    ...base,
    start: { dateTime: start.toISOString(), timeZone: zone },
    end: { dateTime: safeEnd.toISOString(), timeZone: zone },
  };
}

export type CrmTimes = { date: string; time: string | null; end_time: string | null };

/** A Google event's times on the company's wall clock, or null if it has none. */
export function crmTimesFromGoogle(g: GoogleEvent, zone: string): CrmTimes | null {
  if (g.start?.date) return { date: g.start.date, time: null, end_time: null };
  if (!g.start?.dateTime) return null;
  const s = wallClockIn(new Date(g.start.dateTime), zone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${s.year}-${pad(s.month)}-${pad(s.day)}`;
  const time = `${pad(s.hour)}:${pad(s.minute)}`;
  let end_time: string | null = null;
  if (g.end?.dateTime) {
    const en = wallClockIn(new Date(g.end.dateTime), zone);
    const endDate = `${en.year}-${pad(en.month)}-${pad(en.day)}`;
    // The CRM has no end date: an end on another day is kept as "no end"
    // rather than a time that reads as earlier than the start.
    if (endDate === date) end_time = `${pad(en.hour)}:${pad(en.minute)}`;
  }
  return { date, time, end_time };
}

export type PushPlan<L extends SyncLink = SyncLink> = {
  creates: SyncEvent[];
  updates: { event: SyncEvent; link: L }[];
  removes: L[];
};

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);

/**
 * `events` must hold every in-scope appointment from `windowStart` on
 * PLUS every appointment a link points at (so a deletion shows up as a
 * link with no event). Older unlinked appointments are history: never
 * created after the fact. Older linked ones stay maintained.
 */
export function planPush<L extends SyncLink>(
  events: SyncEvent[],
  links: L[],
  scope: ConnectionScope,
  windowStart: string
): PushPlan<L> {
  const byEvent = new Map(links.map((l) => [l.event_id, l]));
  const seen = new Set<string>();
  const plan: PushPlan<L> = { creates: [], updates: [], removes: [] };

  for (const e of events) {
    seen.add(e.id);
    const l = byEvent.get(e.id);
    const wanted = eventWanted(e, scope);
    if (!wanted) {
      if (l) plan.removes.push(l);
      continue;
    }
    if (!l) {
      if (e.date >= windowStart) plan.creates.push(e);
      continue;
    }
    if (ms(e.updated_at) > ms(l.crm_updated_at)) plan.updates.push({ event: e, link: l });
  }
  for (const l of links) {
    if (!seen.has(l.event_id)) plan.removes.push(l);
  }
  return plan;
}

export type PullDecision =
  | { kind: "skip"; reason: string }
  | { kind: "cancel" }
  | { kind: "reschedule"; date: string; time: string | null; end_time: string | null };

/** What a changed Google event means for its CRM appointment. */
export function decidePull(g: GoogleEvent, link: SyncLink, e: SyncEvent | null, zone: string): PullDecision {
  if (!e) return { kind: "skip", reason: "appointment gone" };
  if (g.etag && g.etag === link.google_etag) return { kind: "skip", reason: "own write" };

  // Both sides moved since the last sync: the later edit wins. A CRM
  // edit that is newer than Google's will be pushed over it next.
  const crmChanged = ms(e.updated_at) > ms(link.crm_updated_at);
  if (crmChanged && ms(g.updated) <= ms(e.updated_at)) return { kind: "skip", reason: "crm newer" };

  if (g.status === "cancelled") {
    return DEAD_STATUSES.has(e.status) ? { kind: "skip", reason: "already dead" } : { kind: "cancel" };
  }

  const times = crmTimesFromGoogle(g, zone);
  if (!times) return { kind: "skip", reason: "no times" };
  const same =
    times.date === e.date && times.time === hhmm(e.time) && times.end_time === hhmm(e.end_time);
  if (same) return { kind: "skip", reason: "unchanged" };
  return { kind: "reschedule", ...times };
}
