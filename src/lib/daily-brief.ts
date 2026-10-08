import { addDays, dayStartInZone, isoDateInZone } from "./company-clock.ts";
import { appointmentAttended, type EventStatus } from "./data/types.ts";
import { countsAsLead } from "./lead-or-contact.ts";
import { isClosedStageKey } from "./pipeline/stage-keys.ts";
import { weekBounds } from "./production-board.ts";

export type BriefPeriod = "today" | "week" | "month";

/**
 * Where each period starts, at midnight on the company's clock: Today
 * that morning, This Week on Monday, This Month on the 1st. `since` is
 * what timestamps are compared with, `sinceDay` what an appointment's
 * plain date is compared with.
 */
export function briefPeriodStart(
  period: BriefPeriod,
  now: Date,
  zone: string
): { since: string; sinceDay: string } {
  const today = isoDateInZone(now, zone);
  const day =
    period === "today" ? today : period === "week" ? weekBounds(today).start : `${today.slice(0, 8)}01`;
  return { since: dayStartInZone(day, zone).toISOString(), sinceDay: day };
}

export type BriefBreakdown = {
  topSources: { source: string; count: number }[];
  repActivity: { name: string; appts: number; calls: number }[];
};

/**
 * The Daily Brief's two lower tables -- where leads came from, and each
 * rep's appointments booked and calls -- over everything created since
 * `since`. Worked out once per period, so they follow the
 * Today / This Week / This Month chips like the numbers above them.
 */
export function briefBreakdown(
  rows: {
    leads: { created_at: string; source: string | null }[];
    events: { created_at: string; assigned_to: string | null }[];
    calls: { created_at: string; rep_id: string | null }[];
  },
  since: string,
  boughtKeys: string[],
  nameById: Map<string, string>
): BriefBreakdown {
  const sourceTally = new Map<string, number>();
  for (const l of rows.leads) {
    if (l.created_at < since || !countsAsLead(l.source, boughtKeys)) continue;
    const key = l.source as string;
    sourceTally.set(key, (sourceTally.get(key) ?? 0) + 1);
  }
  const topSources = [...sourceTally.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const repTally = new Map<string, { appts: number; calls: number }>();
  for (const e of rows.events) {
    if (e.created_at < since || !e.assigned_to) continue;
    const row = repTally.get(e.assigned_to) ?? { appts: 0, calls: 0 };
    row.appts += 1;
    repTally.set(e.assigned_to, row);
  }
  for (const c of rows.calls) {
    if (c.created_at < since || !c.rep_id) continue;
    const row = repTally.get(c.rep_id) ?? { appts: 0, calls: 0 };
    row.calls += 1;
    repTally.set(c.rep_id, row);
  }
  const repActivity = [...repTally.entries()]
    .map(([id, v]) => ({ name: nameById.get(id) ?? "Unknown", ...v }))
    .sort((a, b) => b.appts + b.calls - (a.appts + a.calls))
    .slice(0, 6);

  return { topSources, repActivity };
}

/**
 * How far the brief reads: back to the earliest period start -- usually
 * the 1st, but a week that began last month starts first -- and, for the
 * appointment warnings, a week ahead.
 */
export function briefReadWindow(
  now: Date,
  zone: string
): { since: string; sinceDay: string; today: string; weekAhead: string } {
  const first = (["today", "week", "month"] as const)
    .map((p) => briefPeriodStart(p, now, zone))
    .reduce((a, b) => (b.since < a.since ? b : a));
  const today = isoDateInZone(now, zone);
  return { since: first.since, sinceDay: first.sinceDay, today, weekAhead: addDays(today, 7) };
}

export type BriefStats = {
  leadsAdded: number;
  apptsBooked: number;
  apptsScheduled: number;
  showed: number;
  noShow: number;
  calls: number;
  talkMinutes: number;
  textsOut: number;
  textsIn: number;
  tasksCompleted: number;
  won: number;
  wonValue: number;
};

export type BriefAttention = {
  overdueTasks: number;
  unconfirmedSoon: number;
  staleRefunds: number;
  rainRisk: number;
};

/**
 * What the brief reads, each set only as far as a figure needs
 * (`briefReadWindow`) -- never the whole contact book.
 */
export type BriefRows = {
  /** Leads created since the window opened. */
  newLeads: { created_at: string; source: string | null }[];
  /** Leads won since then, whenever they came in. */
  wonLeads: { won_at: string; value: number | null }[];
  /** Leads whose refund request is still open. */
  openRefunds: { refund_requested_at: string | null }[];
  /** Appointments booked since then. */
  bookedEvents: { created_at: string; assigned_to: string | null }[];
  /** Appointments dated from the window's first day to a week ahead. */
  datedEvents: { date: string; status: string; customer_confirmed: boolean; rain_alert_pop: number | null }[];
  calls: { created_at: string; duration_seconds: number; rep_id: string | null }[];
  texts: { created_at: string; direction: string }[];
  /** Tasks completed since then. */
  doneTasks: { completed_at: string }[];
  /** Open tasks past due, each with its lead's stage. */
  overdueTasks: { leads: { stage_key: string | null } | null }[];
};

/**
 * Every figure on the brief: the tiles and tables for each period, and
 * the always-live Needs Attention counts.
 */
export function briefNumbers(
  rows: BriefRows,
  now: Date,
  zone: string,
  boughtKeys: string[],
  nameById: Map<string, string>
): {
  periods: Record<BriefPeriod, BriefStats>;
  attention: BriefAttention;
  breakdown: Record<BriefPeriod, BriefBreakdown>;
} {
  const todayISO = isoDateInZone(now, zone);
  const in2Days = addDays(todayISO, 2);
  const in7Days = addDays(todayISO, 7);
  const periodStart = (period: BriefPeriod) => briefPeriodStart(period, now, zone);

  function statsFor(period: BriefPeriod): BriefStats {
    const { since, sinceDay } = periodStart(period);
    const periodEvents = rows.datedEvents.filter((e) => e.date >= sinceDay && e.date <= todayISO);
    const wonInPeriod = rows.wonLeads.filter((l) => l.won_at >= since);
    const periodCalls = rows.calls.filter((c) => c.created_at >= since);
    return {
      // Real leads only: a bought-list import isn't leads (DECISIONS #156).
      leadsAdded: rows.newLeads.filter((l) => l.created_at >= since && countsAsLead(l.source, boughtKeys)).length,
      apptsBooked: rows.bookedEvents.filter((e) => e.created_at >= since).length,
      apptsScheduled: periodEvents.length,
      showed: periodEvents.filter((e) => appointmentAttended(e.status as EventStatus)).length,
      noShow: periodEvents.filter((e) => e.status === "No-show").length,
      calls: periodCalls.length,
      talkMinutes: Math.round(periodCalls.reduce((t, c) => t + (c.duration_seconds || 0), 0) / 60),
      textsOut: rows.texts.filter((t) => t.created_at >= since && t.direction === "outbound").length,
      textsIn: rows.texts.filter((t) => t.created_at >= since && t.direction === "inbound").length,
      tasksCompleted: rows.doneTasks.filter((t) => t.completed_at >= since).length,
      won: wonInPeriod.length,
      wonValue: wonInPeriod.reduce((t, l) => t + (Number(l.value) || 0), 0),
    };
  }

  const attention: BriefAttention = {
    // Skips tasks hanging off a closed lead (won, lost, not interested,
    // do-not-contact). Three of these were auto-created "no outcome set"
    // follow-ups on appointments whose leads were later won -- counting
    // them made the brief disagree with the pipeline's Follow-ups Due
    // panel, which ignores closed leads too.
    overdueTasks: rows.overdueTasks.filter((t) => !isClosedStageKey(t.leads?.stage_key)).length,
    // Appointments in the next couple of days the customer hasn't confirmed
    // -- the ones most likely to become a wasted trip.
    unconfirmedSoon: rows.datedEvents.filter(
      (e) =>
        e.date >= todayISO &&
        e.date <= in2Days &&
        !e.customer_confirmed &&
        e.status !== "Cancelled"
    ).length,
    staleRefunds: rows.openRefunds.filter(
      (l) =>
        l.refund_requested_at &&
        now.getTime() - new Date(l.refund_requested_at).getTime() > 30 * 86400000
    ).length,
    // Outdoor-sensitive appointments this week the rain-alerts cron has
    // flagged (50%+ chance of rain) -- the office's cue to call and
    // reschedule before the crew shows up to a wash-out.
    rainRisk: rows.datedEvents.filter(
      (e) =>
        e.date >= todayISO &&
        e.date <= in7Days &&
        e.status !== "Cancelled" &&
        (e.rain_alert_pop ?? 0) >= 50
    ).length,
  };

  const breakdownRows = { leads: rows.newLeads, events: rows.bookedEvents, calls: rows.calls };
  const breakdownFor = (period: BriefPeriod) =>
    briefBreakdown(breakdownRows, periodStart(period).since, boughtKeys, nameById);

  return {
    periods: { today: statsFor("today"), week: statsFor("week"), month: statsFor("month") },
    attention,
    breakdown: { today: breakdownFor("today"), week: breakdownFor("week"), month: breakdownFor("month") },
  };
}
