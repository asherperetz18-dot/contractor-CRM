import { moneyCents } from "./data/types.ts";
import { daysLate, type InvoiceStatus } from "./data/invoice-rows.ts";
import { wallClockIn } from "./company-clock.ts";

/**
 * Automatic payment reminders (DECISIONS #152): when one is due on a
 * bill, and what it says. Pure, so the scheduled job and the tests share
 * it.
 *
 * A bill still owed gets a reminder 3 days before it's due, one on the
 * day, and once a week after, up to three times. Each step goes once, and
 * never within 2 days of the last thing the customer was sent about the
 * bill (6 for the weekly ones) -- the bill itself, a send again, or a
 * reminder -- so a bill sent yesterday isn't chased today, and a job that
 * missed a day catches up with one reminder, not a burst.
 */

export const REMINDER_KINDS = ["before", "due", "late1", "late2", "late3"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

const LATE_KINDS: ReminderKind[] = ["late1", "late2", "late3"];

/** The bills a reminder can go to: owed, and with no payment already on its way. */
export const REMINDER_STATUSES: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>([
  "billed",
  "sent",
  "viewed",
  "partial",
  "overdue",
]);

/** How many days before the due date the first reminder goes. */
export const REMINDER_DAYS_BEFORE = 3;

export function nextReminder(p: {
  /** YYYY-MM-DD; a bill with none is never reminded. */
  dueDate: string | null;
  /** The company's own YYYY-MM-DD. */
  today: string;
  /** The steps already sent for this bill. */
  sentKinds: ReminderKind[];
  /** The company day of the last send to the customer about this bill. */
  lastTouchDay: string | null;
}): ReminderKind | null {
  if (!p.dueDate) return null;
  const late = daysLate(p.dueDate, p.today);
  const quiet = p.lastTouchDay ? daysLate(p.lastTouchDay, p.today) : Infinity;
  const sent = new Set(p.sentKinds);

  if (late >= -REMINDER_DAYS_BEFORE && late <= -1) {
    return !sent.has("before") && quiet >= 2 ? "before" : null;
  }
  if (late === 0) return !sent.has("due") && quiet >= 2 ? "due" : null;
  if (late < 7 || quiet < 6) return null;
  const done = LATE_KINDS.filter((k) => sent.has(k)).length;
  if (done >= LATE_KINDS.length) return null;
  return late >= 7 * (done + 1) ? LATE_KINDS[done] : null;
}

/** Reminders go out from 9am to 6pm on the company's clock. */
export function inReminderHours(now: Date, ianaZone: string): boolean {
  const hour = wallClockIn(now, ianaZone).hour;
  return hour >= 9 && hour < 18;
}

export function reminderKindLabel(kind: string): string {
  if (kind === "before") return `${REMINDER_DAYS_BEFORE} days before`;
  if (kind === "due") return "due day";
  const n = Number(kind.replace("late", ""));
  return n === 1 ? "1 week late" : `${n} weeks late`;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const longDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const shortDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export type ReminderInput = {
  kind: ReminderKind;
  companyName: string;
  customerName: string | null;
  isInvoice: boolean;
  docNumber: string;
  title: string | null;
  /** The stage billed, for a contract or change order. */
  stageName: string | null;
  /** What is still owed on the bill. */
  owedCents: number;
  /** YYYY-MM-DD. */
  dueDate: string;
  /** The company's YYYY-MM-DD. */
  today: string;
  link: string;
};

export function reminderMessage(p: ReminderInput): { subject: string; text: string; html: string; sms: string } {
  const amount = moneyCents(p.owedCents);
  const what = p.isInvoice ? `invoice ${p.docNumber}` : `${p.stageName || "Progress payment"} on ${p.docNumber}`;
  const titled = `${what}${p.title ? ` (${p.title})` : ""}`;
  const late = daysLate(p.dueDate, p.today);
  const isLate = p.kind.startsWith("late");

  const subject = isLate
    ? `Past due: ${what}, ${amount}`
    : `Reminder: ${what}, ${amount} due ${p.kind === "due" ? "today" : longDay(p.dueDate)}`;
  const opening = isLate
    ? `A reminder: ${titled} was due on ${longDay(p.dueDate)}, ${late === 1 ? "1 day" : `${late} days`} ago.`
    : p.kind === "due"
      ? `A friendly reminder: ${titled} is due today.`
      : `A friendly reminder: ${titled} is due on ${longDay(p.dueDate)}.`;
  const greeting = p.customerName?.trim() || "there";
  const already = "If you've already paid, thank you, and please ignore this.";

  const text = [
    `Hi ${greeting},`,
    ``,
    opening,
    ``,
    `Amount due: ${amount}`,
    ``,
    `View and pay: ${p.link}`,
    `The link signs you in to your customer page. It expires in 7 days.`,
    ``,
    already,
    ``,
    `Thank you,`,
    p.companyName,
  ].join("\n");

  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px">`,
    `<p>Hi ${escapeHtml(greeting)},</p>`,
    `<p>${escapeHtml(opening)}</p>`,
    `<p style="margin:0 0 18px"><strong>Amount due: ${escapeHtml(amount)}</strong></p>`,
    `<p><a href="${escapeHtml(p.link)}" style="display:inline-block;background:#c8601f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold">View and pay</a></p>`,
    `<p style="font-size:13px;color:#666">The link signs you in to your customer page. It expires in 7 days.</p>`,
    `<p style="font-size:13px;color:#666">${escapeHtml(already)}</p>`,
    `<p>Thank you,<br>${escapeHtml(p.companyName)}</p>`,
    `</div>`,
  ].join("");

  // Plain hyphens, no emoji: either one flips a text to UCS-2 and cuts
  // each segment from 160 characters to 70.
  const when = isLate ? `was due ${shortDay(p.dueDate)}` : p.kind === "due" ? "is due today" : `is due ${shortDay(p.dueDate)}`;
  const sms = `${p.companyName}: reminder - ${what} ${when} - ${amount}.\nPay here: ${p.link}`;

  return { subject, text, html, sms };
}
