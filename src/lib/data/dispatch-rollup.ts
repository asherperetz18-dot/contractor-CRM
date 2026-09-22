import { isoDay, prevWindow, type DateWindow } from "./date-range.ts";
import { NO_DISPOSITION, PRE_APPOINTMENT_STAGES, type EventStatus } from "./types.ts";

/**
 * The Dispatch Dashboard, reduced to the numbers its cards render.
 *
 * Same contract as the main dashboard (dashboard-rollup.ts): the
 * database reduces everything in one call (dispatch_rollup, migration
 * 0171) and buildDispatchRollup is that SQL's tested mirror -- and the
 * server-side fallback until the migration has run. Every clock edge
 * arrives precomputed in DispatchBoundaries and goes to the SQL as a
 * parameter, so the two sides can never disagree about "today".
 *
 * The page answers one question -- is every lead being worked fast, and
 * is the calendar filling -- so the buckets are about speed and the
 * board, never money:
 *
 *   * A lead's FIRST TOUCH is the earliest call logged, text sent or
 *     note written on it. "Reached within the hour" is that touch
 *     landing within 60 minutes of the lead arriving.
 *   * "Untouched new" is a lead of the last 7 days still in a
 *     pre-appointment stage with no touch at all.
 *   * "Waiting" is every pre-appointment lead received in the last 90
 *     days -- older ones are dead, not waiting -- bucketed by age.
 *   * "Booked" is an appointment CREATED in the window (its created_by
 *     is the dispatcher who booked it); "showed" is one DATED in the
 *     window with Showed or Won logged, "resolved" one with any result.
 *   * Texts count outbound customer texts only; a text has no sender
 *     column, so the desk table carries no per-person text count.
 */

export type DispatchBoundaries = {
  today: string;
  /** The real instant, for ages measured in minutes. */
  nowIso: string;
  from: string;
  to: string | null;
  prevFrom: string | null;
  prevTo: string | null;
  /** Six days after today: the week strip's last column. */
  weekEnd: string;
  /** 7 days back: the floor for "new leads nobody has touched". */
  untouchedFrom: string;
  /** 14 days back: how far past appointments are chased for a result. */
  resultsFrom: string;
  /** 90 days back: the floor for "waiting for a first appointment". */
  waitingFrom: string;
};

/** Leads received before this many days ago are not "waiting", they are gone. */
export const WAITING_DAYS = 90;
export const UNTOUCHED_DAYS = 7;
export const RESULTS_DAYS = 14;
export const REACHED_MINUTES = 60;

export function dispatchBoundaries(
  win: DateWindow,
  now: Date,
  nowMs: number = Date.now()
): DispatchBoundaries {
  const prev = prevWindow(win, now);
  const daysFrom = (n: number) =>
    isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  const waitingFrom = daysFrom(-WAITING_DAYS);
  // A window with no start would make the cohort the whole book; the
  // presets never produce one, and a half-typed custom range caps at
  // the waiting floor instead.
  const from = win.from ?? waitingFrom;
  const capped: DateWindow = { from, to: win.to };
  const prevCapped = win.from ? prev : prevWindow(capped, now);
  return {
    today: isoDay(now),
    nowIso: new Date(nowMs).toISOString(),
    from,
    to: win.to,
    prevFrom: prevCapped?.from ?? null,
    prevTo: prevCapped?.to ?? null,
    weekEnd: daysFrom(6),
    untouchedFrom: daysFrom(-UNTOUCHED_DAYS),
    resultsFrom: daysFrom(-RESULTS_DAYS),
    waitingFrom,
  };
}

export type DispatchWindowTotals = {
  leads: number;
  /** Leads with any touch at all. */
  reached: number;
  reachedWithinHour: number;
  /** Median minutes from arrival to first touch, over touched leads; null when none. */
  medianMinutes: number | null;
  booked: number;
  showed: number;
  resolved: number;
  dials: number;
  connected: number;
  texts: number;
};

export type TodayVisit = {
  id: string;
  time: string | null;
  end_time: string | null;
  title: string | null;
  lead_id: string | null;
  lead_name: string | null;
  assigned_to: string | null;
  status: EventStatus;
  customer_confirmed: boolean;
  rep_confirmed: boolean;
};

export type WaitingBuckets = {
  under1: number;
  d1_3: number;
  d4_7: number;
  d8_14: number;
  d15plus: number;
};

export type DeskRow = {
  dispatcher: string;
  /** Leads received in the window held by this dispatcher: the book-rate denominator. */
  leadsReceived: number;
  /** Their leads still waiting for a first appointment (the waiting floor applies). */
  leadsHeld: number;
  dials: number;
  connected: number;
  booked: number;
  showed: number;
};

export type DispatchRollup = {
  attention: {
    untouchedNew: number;
    untouchedOldestMinutes: number | null;
    overdueTasks: number;
    todayTotal: number;
    todayUnconfirmed: number;
    resultsMissing: number;
    unclaimedPool: number;
  };
  window: DispatchWindowTotals;
  prev: DispatchWindowTotals;
  today: TodayVisit[];
  week: { day: string; count: number }[];
  waiting: WaitingBuckets;
  outcomes: { disposition: string; count: number }[];
  desk: DeskRow[];
};

/** The rows the fallback fetches; the SQL reads the same tables. */
export type DispatchInputs = {
  boundaries: DispatchBoundaries;
  /** Leads created in the window, each with its earliest touch. */
  cohort: { id: string; created_at: string; dispatcher_id: string | null; first_touch_at: string | null }[];
  prevCohort: { id: string; created_at: string; dispatcher_id: string | null; first_touch_at: string | null }[];
  /** Pre-appointment leads since untouchedFrom with no touch at all. */
  untouched: { created_at: string }[];
  /** Pre-appointment leads since waitingFrom. */
  waiting: { created_at: string; dispatcher_id: string | null }[];
  todayEvents: TodayVisit[];
  /** Events dated today through weekEnd. */
  weekEvents: { date: string; status: string }[];
  /** Events dated resultsFrom..yesterday still without a result. */
  resultsMissing: number;
  overdueTasks: number;
  /** Events created in the window. */
  bookedInWindow: { created_by: string | null }[];
  prevBookedCount: number;
  /** Events dated in the window. */
  datedInWindow: { created_by: string | null; status: string }[];
  prevDated: { created_by: string | null; status: string }[];
  callsInWindow: { rep_id: string | null; duration_seconds: number | null; disposition: string | null }[];
  prevCalls: { dials: number; connected: number };
  textsInWindow: number;
  prevTexts: number;
};

const num = (v: unknown) => Number(v) || 0;
const ATTENDED = new Set<string>(["Showed", "Won"]);
const RESOLVED = new Set<string>(["Showed", "Won", "No-show", "Cancelled"]);
/** Statuses where a visit is still ahead and confirmation still matters. */
const AHEAD = new Set<string>(["New", "Confirmed"]);

function minutesBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD), DST-proof. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function speed(cohort: DispatchInputs["cohort"]) {
  let reached = 0;
  let reachedWithinHour = 0;
  const minutes: number[] = [];
  for (const l of cohort) {
    if (!l.first_touch_at) continue;
    reached += 1;
    const m = minutesBetween(l.created_at, l.first_touch_at);
    minutes.push(m);
    if (m <= REACHED_MINUTES) reachedWithinHour += 1;
  }
  return { reached, reachedWithinHour, medianMinutes: median(minutes) };
}

/** Sorted by time, no-time visits last -- the schedule's own order. */
function byTime(a: TodayVisit, b: TodayVisit): number {
  if (!a.time && !b.time) return 0;
  if (!a.time) return 1;
  if (!b.time) return -1;
  return a.time.localeCompare(b.time);
}

export function buildDispatchRollup(inputs: DispatchInputs): DispatchRollup {
  const B = inputs.boundaries;

  // ── Untouched new leads: how many, and how long the oldest has waited
  let oldest: string | null = null;
  for (const l of inputs.untouched) {
    if (!oldest || l.created_at < oldest) oldest = l.created_at;
  }

  // ── Today's board and the week strip ─────────────────────────────
  const today = inputs.todayEvents.filter((e) => e.status !== "Cancelled").sort(byTime);
  const todayUnconfirmed = today.filter((e) => AHEAD.has(e.status) && !e.customer_confirmed).length;

  const week: { day: string; count: number }[] = [];
  const weekIndex = new Map<string, number>();
  const start = new Date(`${B.today}T12:00:00`);
  for (let i = 0; i < 7; i++) {
    const day = isoDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    weekIndex.set(day, week.length);
    week.push({ day, count: 0 });
  }
  for (const e of inputs.weekEvents) {
    if (e.status === "Cancelled") continue;
    const i = weekIndex.get(e.date);
    if (i !== undefined) week[i].count += 1;
  }

  // ── Waiting for a first appointment, by age; the unclaimed pool ──
  const waiting: WaitingBuckets = { under1: 0, d1_3: 0, d4_7: 0, d8_14: 0, d15plus: 0 };
  let unclaimedPool = 0;
  const heldBy = new Map<string, number>();
  for (const l of inputs.waiting) {
    const days = daysBetween(l.created_at.slice(0, 10), B.today);
    if (days < 1) waiting.under1 += 1;
    else if (days <= 3) waiting.d1_3 += 1;
    else if (days <= 7) waiting.d4_7 += 1;
    else if (days <= 14) waiting.d8_14 += 1;
    else waiting.d15plus += 1;
    if (l.dispatcher_id) heldBy.set(l.dispatcher_id, (heldBy.get(l.dispatcher_id) ?? 0) + 1);
    else unclaimedPool += 1;
  }

  // ── Call outcomes: your own disposition names, the empty one left out
  const outcomeMap = new Map<string, number>();
  let connected = 0;
  for (const c of inputs.callsInWindow) {
    if ((c.duration_seconds || 0) > 0) connected += 1;
    const d = c.disposition;
    if (!d || d === NO_DISPOSITION) continue;
    outcomeMap.set(d, (outcomeMap.get(d) ?? 0) + 1);
  }

  // ── The desk: one row per dispatcher ─────────────────────────────
  const desk = new Map<string, DeskRow>();
  const row = (id: string) => {
    const r = desk.get(id) ?? {
      dispatcher: id,
      leadsReceived: 0,
      leadsHeld: 0,
      dials: 0,
      connected: 0,
      booked: 0,
      showed: 0,
    };
    desk.set(id, r);
    return r;
  };
  for (const l of inputs.cohort) if (l.dispatcher_id) row(l.dispatcher_id).leadsReceived += 1;
  for (const [id, n] of heldBy) row(id).leadsHeld = n;
  for (const c of inputs.callsInWindow) {
    if (!c.rep_id) continue;
    const r = row(c.rep_id);
    r.dials += 1;
    if ((c.duration_seconds || 0) > 0) r.connected += 1;
  }
  for (const e of inputs.bookedInWindow) if (e.created_by) row(e.created_by).booked += 1;
  let showed = 0;
  let resolved = 0;
  for (const e of inputs.datedInWindow) {
    if (ATTENDED.has(e.status)) {
      showed += 1;
      if (e.created_by) row(e.created_by).showed += 1;
    }
    if (RESOLVED.has(e.status)) resolved += 1;
  }
  // Someone with calls but no bookings is still a row; someone who only
  // has an old lead held and nothing this period is too -- the desk is
  // everyone holding work, not just the busy.
  const deskRows = [...desk.values()].filter(
    (r) => r.leadsReceived || r.leadsHeld || r.dials || r.booked || r.showed
  );

  const cur = speed(inputs.cohort);
  const prevSpeed = speed(inputs.prevCohort);

  return {
    attention: {
      untouchedNew: inputs.untouched.length,
      untouchedOldestMinutes: oldest ? Math.max(0, minutesBetween(oldest, B.nowIso)) : null,
      overdueTasks: inputs.overdueTasks,
      todayTotal: today.length,
      todayUnconfirmed,
      resultsMissing: inputs.resultsMissing,
      unclaimedPool,
    },
    window: {
      leads: inputs.cohort.length,
      reached: cur.reached,
      reachedWithinHour: cur.reachedWithinHour,
      medianMinutes: cur.medianMinutes,
      booked: inputs.bookedInWindow.length,
      showed,
      resolved,
      dials: inputs.callsInWindow.length,
      connected,
      texts: inputs.textsInWindow,
    },
    prev: {
      leads: inputs.prevCohort.length,
      reached: prevSpeed.reached,
      reachedWithinHour: prevSpeed.reachedWithinHour,
      medianMinutes: prevSpeed.medianMinutes,
      booked: inputs.prevBookedCount,
      showed: inputs.prevDated.filter((e) => ATTENDED.has(e.status)).length,
      resolved: inputs.prevDated.filter((e) => RESOLVED.has(e.status)).length,
      dials: inputs.prevCalls.dials,
      connected: inputs.prevCalls.connected,
      texts: inputs.prevTexts,
    },
    today,
    week,
    waiting,
    outcomes: [...outcomeMap.entries()]
      .map(([disposition, count]) => ({ disposition, count }))
      .sort((a, b) => b.count - a.count || a.disposition.localeCompare(b.disposition)),
    desk: deskRows.sort(
      (a, b) =>
        b.booked - a.booked ||
        b.dials - a.dials ||
        b.leadsHeld - a.leadsHeld ||
        a.dispatcher.localeCompare(b.dispatcher)
    ),
  };
}

/** The stages a lead is still being chased in -- the SQL takes the same list. */
export const WAITING_STAGES: readonly string[] = PRE_APPOINTMENT_STAGES;

/**
 * The RPC's jsonb, coerced field by field: aggregates can cross JSON as
 * strings, and a stringly "40" would concatenate through every sum.
 */
export function coerceDispatchRollup(raw: unknown): DispatchRollup {
  const r = (raw ?? {}) as Record<string, unknown>;
  const obj = (v: unknown) => (v ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const nullable = (v: unknown) => (v === null || v === undefined || v === "" ? null : num(v));
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const totals = (v: unknown): DispatchWindowTotals => {
    const t = obj(v);
    return {
      leads: num(t.leads),
      reached: num(t.reached),
      reachedWithinHour: num(t.reachedWithinHour),
      medianMinutes: nullable(t.medianMinutes),
      booked: num(t.booked),
      showed: num(t.showed),
      resolved: num(t.resolved),
      dials: num(t.dials),
      connected: num(t.connected),
      texts: num(t.texts),
    };
  };
  const a = obj(r.attention);
  const w = obj(r.waiting);
  return {
    attention: {
      untouchedNew: num(a.untouchedNew),
      untouchedOldestMinutes: nullable(a.untouchedOldestMinutes),
      overdueTasks: num(a.overdueTasks),
      todayTotal: num(a.todayTotal),
      todayUnconfirmed: num(a.todayUnconfirmed),
      resultsMissing: num(a.resultsMissing),
      unclaimedPool: num(a.unclaimedPool),
    },
    window: totals(r.window),
    prev: totals(r.prev),
    today: arr(r.today).map((e: Record<string, unknown>) => ({
      id: String(e.id ?? ""),
      time: str(e.time),
      end_time: str(e.end_time),
      title: str(e.title),
      lead_id: str(e.lead_id),
      lead_name: str(e.lead_name),
      assigned_to: str(e.assigned_to),
      status: String(e.status ?? "New") as EventStatus,
      customer_confirmed: e.customer_confirmed === true || e.customer_confirmed === "true",
      rep_confirmed: e.rep_confirmed === true || e.rep_confirmed === "true",
    })),
    week: arr(r.week).map((d: Record<string, unknown>) => ({
      day: String(d.day ?? ""),
      count: num(d.count),
    })),
    waiting: {
      under1: num(w.under1),
      d1_3: num(w.d1_3),
      d4_7: num(w.d4_7),
      d8_14: num(w.d8_14),
      d15plus: num(w.d15plus),
    },
    outcomes: arr(r.outcomes).map((o: Record<string, unknown>) => ({
      disposition: String(o.disposition ?? ""),
      count: num(o.count),
    })),
    desk: arr(r.desk).map((d: Record<string, unknown>) => ({
      dispatcher: String(d.dispatcher ?? ""),
      leadsReceived: num(d.leadsReceived),
      leadsHeld: num(d.leadsHeld),
      dials: num(d.dials),
      connected: num(d.connected),
      booked: num(d.booked),
      showed: num(d.showed),
    })),
  };
}

export function emptyDispatchRollup(): DispatchRollup {
  return coerceDispatchRollup({});
}
