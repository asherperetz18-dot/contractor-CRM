"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { setBillRemindersPaused } from "@/lib/actions/progress-billing";
import { reminderKindLabel } from "@/lib/bill-reminder";

/**
 * Automatic payment reminders on one bill (DECISIONS #152): which went,
 * and Stop / Resume. The page says once whether the company has them
 * switched on, and which went on its bills; the bills deep inside the
 * payment schedule read it from here instead of being handed it level by
 * level.
 */

export type SentReminder = { estimate_payment_id: string; kind: string; sent_at: string };

const BillReminders = createContext<{ on: boolean; sent: SentReminder[] }>({ on: false, sent: [] });

export function BillRemindersProvider({ on, sent, children }: { on: boolean; sent: SentReminder[]; children: ReactNode }) {
  return <BillReminders.Provider value={{ on, sent }}>{children}</BillReminders.Provider>;
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** "reminded Oct 18 (3 days before), Oct 21 (due day)": what went on one bill. */
export function RemindersSent({ phaseId, prefix = "" }: { phaseId: string; prefix?: string }) {
  const { sent } = useContext(BillReminders);
  const mine = sent.filter((r) => r.estimate_payment_id === phaseId).sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  if (!mine.length) return null;
  return (
    <span className="est-phase-due-note">
      {prefix}reminded {mine.map((r) => `${fmtDay(r.sent_at)} (${reminderKindLabel(r.kind)})`).join(", ")}
    </span>
  );
}

/**
 * Stop reminders on a bill (a payment plan agreed, a bill in dispute), or
 * start them again. Only where the company has reminders on, and only
 * once 0208 has given the bill its switch.
 */
export function RemindersToggle({ phaseId, paused }: { phaseId: string; paused: boolean | undefined }) {
  const { on } = useContext(BillReminders);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!on || paused === undefined) return null;

  return (
    <>
      {paused && <span className="est-phase-due-note">reminders stopped</span>}
      <button
        type="button"
        className="btn-ghost"
        disabled={pending}
        title={
          paused
            ? "Start sending this bill's automatic payment reminders again"
            : "No more automatic payment reminders on this bill (a payment plan, say)"
        }
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await setBillRemindersPaused(phaseId, !paused);
            if (res.error) return setError(res.error);
            router.refresh();
          });
        }}
      >
        {pending ? "Saving…" : paused ? "Resume reminders" : "Stop reminders"}
      </button>
      {error && <span className="error-note">{error}</span>}
    </>
  );
}
