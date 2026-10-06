// The phone's Today screen (DECISIONS #090): what the office or a rep sees
// first on a phone. Pure, so it is tested without a browser; the screen
// is src/app/(app)/phone-today.tsx. The alert rows are the desktop
// dashboard's own (dashboard-view.tsx reads attentionItems too), so the
// two can never disagree about what is overdue or where it links.

import { clientName } from "./data/client-name.ts";
import { money } from "./data/types.ts";
import type { DashboardRollup } from "./data/dashboard-rollup.ts";

const cents = (v: number) => money(v / 100);

export type AttentionItem = {
  key: "tasks" | "overdue" | "awaiting" | "replies" | "today";
  href: string;
  /** Red rather than orange: something is late, not merely waiting. */
  alarm: boolean;
  value: string;
  label: string;
};

export function attentionItems(
  a: DashboardRollup["attention"],
  { canMoney, inboxCount }: { canMoney: boolean; inboxCount: number }
): AttentionItem[] {
  const items: (AttentionItem & { show: boolean })[] = [
    {
      key: "tasks",
      show: true,
      href: "/tasks",
      alarm: a.overdueTasks > 0,
      value: String(a.overdueTasks),
      label: "Overdue tasks",
    },
    {
      key: "overdue",
      show: canMoney,
      href: "/payments",
      alarm: a.overdueOwedCents > 0,
      value: cents(a.overdueOwedCents),
      label: `Overdue payments · ${a.overdueOwedCount} ${a.overdueOwedCount === 1 ? "phase" : "phases"}`,
    },
    {
      key: "awaiting",
      show: true,
      href: "/estimates",
      alarm: false,
      value: cents(a.awaitingCents),
      label: `Awaiting signature · ${a.awaitingCount} ${a.awaitingCount === 1 ? "contract" : "contracts"}`,
    },
    {
      key: "replies",
      show: inboxCount > 0,
      href: "/reply-inbox",
      alarm: false,
      value: String(inboxCount),
      label: "Replies waiting",
    },
    {
      key: "today",
      show: true,
      href: "/schedule",
      alarm: false,
      value: String(a.apptsToday),
      label: "Appointments today",
    },
  ];
  return items.filter((i) => i.show).map(({ show: _show, ...i }) => i);
}

/** This period against the last, as the dashboard's KPI tiles say it. */
export function deltaView(cur: number, prev: number): { text: string; dir: "up" | "down" | "flat" } {
  if (prev <= 0) return { text: cur > 0 ? "new" : "—", dir: "flat" };
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return { text: "±0%", dir: "flat" };
  return { text: `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%`, dir: pct > 0 ? "up" : "down" };
}

// Calendar arithmetic on plain YYYY-MM-DD strings, in UTC so the server's
// own time zone can never shift a day: "today" is the company's, decided
// by the caller (companyNow), not this machine's clock.
function utcDay(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function dayLabel(dateISO: string, todayISO: string): string {
  const days = Math.round((utcDay(dateISO).getTime() - utcDay(todayISO).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return utcDay(dateISO).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function longDay(todayISO: string): string {
  return utcDay(todayISO).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

type UpcomingEvent = {
  id: string;
  title: string | null;
  date: string;
  time: string | null;
  end_time: string | null;
  lead_id: string | null;
};
export type UpcomingLead = {
  id: string;
  contact_type?: string | null;
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  address?: string | null;
};

export type UpcomingCard = {
  id: string;
  day: string;
  time: string | null;
  endTime: string | null;
  title: string;
  /** The client, as every other screen names them; "" when the
   *  appointment has no contact. */
  who: string;
  /** Where Navigate drives to; null hides the button. */
  address: string | null;
  href: string;
};

/** The next appointments (three at most) with who and where, so a rep can
 *  tap straight into the contact or the route. */
export function upcomingCards(
  events: UpcomingEvent[],
  leads: UpcomingLead[],
  todayISO: string,
  limit = 3
): UpcomingCard[] {
  const byId = new Map(leads.map((l) => [l.id, l]));
  return events.slice(0, limit).map((e) => {
    const lead = e.lead_id ? byId.get(e.lead_id) : undefined;
    const address = lead?.address?.trim() || null;
    return {
      id: e.id,
      day: dayLabel(e.date, todayISO),
      time: e.time,
      endTime: e.end_time,
      title: e.title?.trim() || "Appointment",
      who: lead ? clientName(lead) : "",
      address,
      href: e.lead_id ? `/contacts?openLead=${e.lead_id}&from=/` : "/schedule",
    };
  });
}

export type QuickAction = { label: string; href: string; page: string };

const QUICK_ACTIONS: QuickAction[] = [
  { label: "New contact", href: "/pipeline?new=1", page: "/pipeline" },
  { label: "Appointment", href: "/schedule?new=1", page: "/schedule" },
  { label: "Estimate", href: "/estimates?new=1", page: "/estimates" },
  { label: "Clock in", href: "/time-clock", page: "/time-clock" },
];

/** The big buttons at the top, minus any whose page this person can't open. */
export function quickActions(visibleHrefs: Iterable<string>): QuickAction[] {
  const visible = new Set(visibleHrefs);
  return QUICK_ACTIONS.filter((q) => visible.has(q.page));
}
