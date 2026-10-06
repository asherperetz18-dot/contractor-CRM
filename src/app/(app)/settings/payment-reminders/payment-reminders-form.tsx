"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBillReminderSettings, type BillReminderSettings } from "@/lib/actions/settings";

/**
 * The company's automatic payment reminders (DECISIONS #152): off until
 * switched on, by email unless it picks text or both.
 */
export function PaymentRemindersForm({ initial }: { initial: BillReminderSettings }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [channel, setChannel] = useState(initial.channel);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const changed = enabled !== initial.enabled || channel !== initial.channel;

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveBillReminderSettings({ enabled, channel });
      if (res.error) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="est-pay">
      <h2 className="est-pay-title">When reminders go</h2>
      <ul className="est-pay-sub">
        <li>3 days before a bill is due</li>
        <li>On the day it&apos;s due</li>
        <li>Once a week after that, up to 3 times</li>
      </ul>
      <p className="est-tax-note">
        They stop as soon as the bill is paid, and wait while a payment is clearing. Each one has the
        amount still owed and a View and pay link, and shows in the customer&apos;s messages. None
        goes within 2 days of the bill itself, and they&apos;re sent between 9am and 6pm your time.
        To stop them on one bill (a payment plan, say), use <strong>Stop reminders</strong> on the
        invoice or the contract&apos;s payment stage. Customers you bill outside the CRM never get
        them.
      </p>
      {!initial.ready && (
        <p className="error-note">
          Reminders need a database update first: run 0208_bill_reminders.sql in Supabase.
        </p>
      )}
      <label className="est-record-check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setSaved(false);
          }}
          disabled={pending || !initial.ready}
        />
        <span>Send customers payment reminders automatically</span>
      </label>
      <label className="field" style={{ maxWidth: 320 }}>
        <span className="field-label">Send them by</span>
        <select
          value={channel}
          onChange={(e) => {
            setChannel(e.target.value as BillReminderSettings["channel"]);
            setSaved(false);
          }}
          disabled={pending || !initial.ready}
        >
          <option value="email">Email</option>
          <option value="text">Text</option>
          <option value="both">Email and text</option>
        </select>
      </label>
      {error && <p className="error-note">{error}</p>}
      {saved && <p className="hint-note">Saved.</p>}
      <div className="est-pay-actions">
        <button className="btn-primary" onClick={save} disabled={pending || !initial.ready || !changed}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}
