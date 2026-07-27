"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  QUICK_TEXT_DEFAULTS,
  type CompanyProfile,
  type SmsQuickText,
  type SmsQuickTextKey,
} from "@/lib/data/types";
import { saveFollowUpSettings } from "@/lib/actions/settings";
import { saveQuickText } from "@/lib/actions/sms-quick-texts";

const QUICK_TEXT_ORDER: SmsQuickTextKey[] = ["confirm", "reschedule", "on_my_way", "running_late"];

function QuickTextCard({ text }: { text: SmsQuickText }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [value, setValue] = useState(text.body ?? "");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setPending(true);
    setError("");
    setSaved(false);
    const result = await saveQuickText(text.key, value);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="cp-card" style={{ marginBottom: 14 }}>
      <div className="cp-card-head">{text.label}</div>
      <p className="cp-card-sub">{text.description}</p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        style={{ width: "100%", fontFamily: "inherit", fontSize: 13, lineHeight: 1.5 }}
        placeholder={QUICK_TEXT_DEFAULTS[text.key]}
      />
      {!text.body && !value && (
        <p className="hint-note" style={{ marginTop: 4 }}>
          Showing default — edit above to override.
        </p>
      )}
      {error && <p className="error-note">{error}</p>}
      <div className="modal-actions">
        <div>{saved && <span className="cp-saved">✓ Saved</span>}</div>
        <div>
          <button className="btn-primary small" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppointmentNotificationsForm({
  followUp,
  quickTexts,
}: {
  followUp: Pick<
    CompanyProfile,
    "no_show_followup_enabled" | "no_show_grace_minutes" | "no_show_lookback_hours"
  > | null;
  quickTexts: SmsQuickText[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(followUp?.no_show_followup_enabled ?? false);
  const [graceMinutes, setGraceMinutes] = useState(
    String(followUp?.no_show_grace_minutes ?? 60)
  );
  const [lookbackHours, setLookbackHours] = useState(
    String(followUp?.no_show_lookback_hours ?? 168)
  );
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function saveFollowUp() {
    setPending(true);
    setError("");
    setSaved(false);
    const result = await saveFollowUpSettings({
      enabled,
      graceMinutes: Number(graceMinutes),
      lookbackHours: Number(lookbackHours),
    });
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
    setTimeout(() => setSaved(false), 2000);
  }

  const orderedTexts = QUICK_TEXT_ORDER.map((key) => quickTexts.find((t) => t.key === key)).filter(
    (t): t is SmsQuickText => !!t
  );

  return (
    <div>
      <div className="ur-breadcrumb">
        <Link href="/settings" className="ur-crumb-link">
          ⚙ Settings
        </Link>
        <span> › </span>
        <span>Appointment Notifications</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Appointment Notifications</h1>
          <p className="module-sub">
            Automatic no-show/cancelled follow-up rules, and the Send SMS quick-text templates
          </p>
        </div>
      </div>

      <div className="cp-card">
        <div className="cp-card-head">⏱ Automatic No-Show / Cancelled Follow-Ups</div>
        <p className="cp-card-sub">
          When on, an appointment left without an outcome (no Showed / No-show / Cancelled
          status) past the grace period below is automatically added as a follow-up task for the
          assigned rep.
        </p>
        <label className="confirm-toggle" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enable automatic follow-ups
        </label>

        <div className="form-grid" style={{ marginTop: 14 }}>
          <label className="field">
            <span className="field-label">Grace period (minutes)</span>
            <input
              type="number"
              min={0}
              value={graceMinutes}
              onChange={(e) => setGraceMinutes(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Look-back window (hours)</span>
            <input
              type="number"
              min={1}
              value={lookbackHours}
              onChange={(e) => setLookbackHours(e.target.value)}
            />
          </label>
        </div>
        <p className="cp-hint">
          How long after an appointment&apos;s start time before an un-marked appointment becomes
          a follow-up (default 60 minutes). Only appointments that started within the look-back
          window are checked, so this never creates follow-ups for old appointments (default 168
          hours / 7 days).
        </p>

        {error && <p className="error-note">{error}</p>}
        <div className="modal-actions">
          <div>{saved && <span className="cp-saved">✓ Saved</span>}</div>
          <div>
            <button className="btn-primary" onClick={saveFollowUp} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      <div className="cp-card" style={{ marginTop: 20 }}>
        <div className="cp-card-head">💬 Appointment SMS Quick-Texts</div>
        <p className="cp-card-sub">
          The default text messages sent from the Send SMS action on an appointment. Edit the
          wording below to change the default for your company; reps can still tweak any message
          before sending.
        </p>
        <p className="hint-note">
          Available variables: <code className="mono">{"{first_name}"}</code>,{" "}
          <code className="mono">{"{when}"}</code>, <code className="mono">{"{rep_name}"}</code>,{" "}
          <code className="mono">{"{company_name}"}</code>
        </p>
      </div>

      {orderedTexts.map((text) => (
        <QuickTextCard key={text.key} text={text} />
      ))}
    </div>
  );
}
