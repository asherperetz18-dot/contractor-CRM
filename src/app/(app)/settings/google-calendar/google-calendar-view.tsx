"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  disconnectGoogleCalendar,
  syncGoogleCalendarNow,
  type CalendarTarget,
  type ConnectionInfo,
  type GoogleCalendarStatus,
} from "@/lib/actions/google-calendar";

function when(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ConnectionCard({
  title,
  intro,
  target,
  info,
  disabled,
}: {
  title: string;
  intro: string;
  target: CalendarTarget;
  info: ConnectionInfo | null;
  disabled: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<"sync" | "disconnect" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function syncNow() {
    setBusy("sync");
    setError("");
    setNote("");
    const res = await syncGoogleCalendarNow(target);
    setBusy(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    const s = res.summary!;
    setNote(
      s.error
        ? `Synced with a problem: ${s.error}`
        : `Done — ${s.created} added to Google, ${s.updated} updated, ${s.removed} removed, ${s.pulled} brought back from Google.`
    );
    startTransition(() => router.refresh());
  }

  async function disconnect() {
    const who = target === "mine" ? "your" : "the company";
    if (!window.confirm(`Disconnect ${who} Google Calendar? Appointments already on it stay there; new changes stop syncing.`)) return;
    setBusy("disconnect");
    setError("");
    const res = await disconnectGoogleCalendar(target);
    setBusy(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  const connectHref = `/api/oauth/google-calendar/authorize?target=${target}`;
  const expired = Boolean(info?.lastError && /reconnect/i.test(info.lastError));

  return (
    <div className="second-contact-block gcal-card">
      <div className="second-contact-head">
        <span>{title}</span>
        {info && !expired && <Badge color="#2F855A">Connected</Badge>}
        {info && expired && <Badge color="#B7791F">Reconnect needed</Badge>}
      </div>
      <p className="hint-note" style={{ marginTop: 0 }}>{intro}</p>

      {info ? (
        <>
          <p className="hint-note">
            Connected as <strong>{info.email ?? "Google account"}</strong>. {info.linked} appointment
            {info.linked === 1 ? "" : "s"} on this calendar. Last sync: {when(info.lastSyncedAt)}.
          </p>
          {info.lastError && <p className="error-note">{info.lastError}</p>}
          <div className="gcal-actions">
            {expired ? (
              <a href={connectHref} className="btn-primary">Reconnect</a>
            ) : (
              <button type="button" className="btn-primary" onClick={syncNow} disabled={busy !== null || disabled}>
                {busy === "sync" ? "Syncing…" : "Sync now"}
              </button>
            )}
            <button type="button" className="btn-danger-ghost" onClick={disconnect} disabled={busy !== null}>
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
          {note && <p className="hint-note">{note}</p>}
        </>
      ) : (
        <a href={connectHref} className={`btn-primary${disabled ? " is-disabled" : ""}`} aria-disabled={disabled}>
          Connect Google Calendar
        </a>
      )}
      {error && <p className="error-note">{error}</p>}
    </div>
  );
}

export function GoogleCalendarView({
  status,
  connectError,
  justConnected,
}: {
  status: GoogleCalendarStatus;
  connectError?: string;
  justConnected?: string;
}) {
  const disabled = !status.configured || status.migrationMissing;
  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Google Calendar</h1>
          <p className="module-sub">Your CRM appointments on the calendar in your pocket, both ways</p>
        </div>
      </div>

      {connectError && <p className="error-note">{connectError}</p>}
      {justConnected && (
        <p className="hint-note" style={{ color: "var(--success)" }}>
          ✓ Connected. The first sync runs within 15 minutes, or press Sync now.
        </p>
      )}
      {!status.configured && (
        <p className="error-note">
          Google Calendar isn&apos;t configured on this deployment yet — a Google OAuth client id and secret are needed.
        </p>
      )}
      {status.migrationMissing && (
        <p className="error-note">
          Google Calendar isn&apos;t set up in the database yet — an admin needs to run migration 0173.
        </p>
      )}

      <div className="gcal-grid">
        <ConnectionCard
          title="Your calendar"
          intro="Appointments where you're the assigned rep (either seat) appear on your own Google Calendar with the client, address, notes and a link back here."
          target="mine"
          info={status.mine}
          disabled={disabled}
        />
        {status.canManageCompany && (
          <ConnectionCard
            title="Company calendar"
            intro="Every appointment in the company, on one Google Calendar the office shares. Connect it with the office's Google account, not a personal one."
            target="company"
            info={status.company}
            disabled={disabled}
          />
        )}
      </div>

      <div className="second-contact-block gcal-card">
        <div className="second-contact-head"><span>How the sync works</span></div>
        <ul className="hint-note gcal-rules">
          <li>Appointments from the last 7 days onward go to Google; older history stays in the CRM.</li>
          <li>Move or resize an appointment in Google and the CRM follows. Delete it in Google and the CRM marks it Cancelled.</li>
          <li>Cancelled and No-show appointments come off Google. Reassigning an appointment moves it to the new rep&apos;s calendar.</li>
          <li>Anything else — the client, notes, status, who&apos;s assigned — is edited in the CRM and pushed to Google.</li>
          <li>Events you create yourself in Google are never copied into the CRM.</li>
          <li>Syncs run every 15 minutes. If both sides changed in between, the later edit wins.</li>
        </ul>
      </div>
    </div>
  );
}
