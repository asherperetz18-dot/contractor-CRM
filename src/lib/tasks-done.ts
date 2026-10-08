import type { BriefPeriod } from "./daily-brief.ts";

/**
 * The Tasks page's Done view (`/tasks?done=today|week|month`): follow-ups
 * marked done in one of the Daily Brief's periods, so its Tasks
 * Completed tile opens the list it counted. Anything else in the link
 * is the ordinary open-tasks view.
 */
export function parseDonePeriod(value: unknown): BriefPeriod | null {
  return value === "today" || value === "week" || value === "month" ? value : null;
}

/**
 * "Oct 7, 9:41 PM" on the company's clock. Worked out on the server and
 * handed to the page as text, so the browser and the server can't print
 * the same moment two ways.
 */
export function doneAtLabel(instant: string, zone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instant));
}
