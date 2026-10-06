// Week approval (DECISIONS #157): the office signs off a person's week
// once it is over, and from then on its hours can't change -- what goes
// to payroll is the week that was approved. The lock itself is in the
// database (0212, time_punches_week_lock); these are the rules the
// screens and actions say out loud.
import { addDays, dayStartInZone } from "../company-clock.ts";

/** Monday 00:00 to the next Monday 00:00 on the company's clock, as
 *  instants: the stretch an approval locks (end not included). */
export function weekPeriod(days: string[], ianaZone: string): { start: string; end: string } {
  return {
    start: dayStartInZone(days[0], ianaZone).toISOString(),
    end: dayStartInZone(addDays(days[6], 1), ianaZone).toISOString(),
  };
}

const OWN_WEEK = "You can't approve or reopen your own week. An Admin can.";

/** Why this person's week can't be approved yet, or null when it can. */
export function approvalBlocker(input: {
  periodEnd: string;
  now: Date;
  /** They have a punch in the week that's still open. */
  open: boolean;
  /** The person approving is the person whose week it is. */
  isSelf: boolean;
  isAdmin: boolean;
}): string | null {
  if (input.now.getTime() < new Date(input.periodEnd).getTime()) {
    return "This week isn't over yet. Approve it once Sunday has passed.";
  }
  if (input.open) return "They're still clocked in on a punch this week. Fix the open punch first.";
  if (input.isSelf && !input.isAdmin) return OWN_WEEK;
  return null;
}

/** Why an approved week can't be reopened, or null when it can. */
export function reopenBlocker(input: { reason: string; isSelf: boolean; isAdmin: boolean }): string | null {
  if (input.reason.trim().length < 3) return "Say why the week is being reopened — it's kept on record.";
  if (input.isSelf && !input.isAdmin) return OWN_WEEK;
  return null;
}
