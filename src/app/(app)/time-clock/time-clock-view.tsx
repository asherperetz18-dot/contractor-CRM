"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptTrackingNotice, clockIn, clockOut, startBreak } from "@/lib/actions/time-clock";
import { punchMinutes, type PunchRow, type ShiftState } from "@/lib/time-clock/hours";
import { TIME_CLOCK_CHANGED, currentFix } from "@/lib/time-clock/client-location";

export type VisitRow = { id: string; label: string; arrived_at: string; left_at: string | null };

function clock(iso: string, zone: string) {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
}

function duration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} m`;
}

function stopwatch(mins: number, secs: number) {
  const h = Math.floor(mins / 60);
  return `${h}:${String(mins % 60).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function TimeClockView({
  zone,
  usesClock,
  noticeAccepted,
  state,
  punches,
  visits,
  appointments,
}: {
  zone: string;
  usesClock: boolean;
  noticeAccepted: boolean;
  state: ShiftState;
  punches: PunchRow[];
  visits: VisitRow[];
  appointments: { id: string; title: string; start: string | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());

  // A local stopwatch tick -- no server call, so not a poll.
  useEffect(() => {
    if (state !== "on") return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [state]);

  function act(fn: () => Promise<{ error?: string }>) {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (res.error) return setError(res.error);
      window.dispatchEvent(new Event(TIME_CLOCK_CHANGED));
      router.refresh();
    });
  }

  if (!usesClock) {
    return (
      <div className="empty-state">
        <p className="empty-label">Your role doesn&apos;t use the time clock</p>
        <p className="empty-hint">The office chooses who clocks in, in Settings › Time Clock &amp; Tracking.</p>
      </div>
    );
  }

  const totalMs = punches.reduce((sum, p) => sum + punchMinutes(p, now) * 60000, 0);
  const openPunch = punches.find((p) => !p.clock_out);
  const liveSecs = openPunch ? Math.floor((now.getTime() - new Date(openPunch.clock_in).getTime()) / 1000) % 60 : 0;
  const totalMins = Math.floor(totalMs / 60000);
  const openVisit = visits.find((v) => !v.left_at);

  // One timeline: punches and arrivals, in time order.
  const timeline = [
    ...punches.flatMap((p) => [
      { at: p.clock_in, text: "Clocked in", mins: null as number | null },
      ...(p.clock_out
        ? [{ at: p.clock_out, text: p.end_reason === "break" ? "Break" : p.end_reason === "auto" ? "Clocked out automatically" : "Clocked out", mins: null }]
        : []),
    ]),
    ...visits.map((v) => ({
      at: v.arrived_at,
      text: v.label,
      mins: v.left_at ? punchMinutes({ id: v.id, profile_id: "", clock_in: v.arrived_at, clock_out: v.left_at, end_reason: null }, now) : null,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="tc-phone">
      <div className="tc-card tc-center">
        <div className="tc-caps">Hours today</div>
        <div className="tc-big">{stopwatch(totalMins, liveSecs)}</div>
        {state === "break" && <span className="tc-chip tc-chip-break">On break</span>}
        {state === "off" && punches.length === 0 && <div className="tc-soft">You&apos;re off the clock</div>}
      </div>

      {state === "on" && openVisit && (
        <div className="tc-card tc-here">
          <strong>At {openVisit.label}</strong>
          <span className="tc-soft">Arrived {clock(openVisit.arrived_at, zone)} · logged automatically</span>
        </div>
      )}

      {!noticeAccepted ? (
        <div className="tc-card tc-notice">
          <strong>Before your first clock-in</strong>
          <p>
            While you&apos;re on the clock, the office sees where you are every few minutes and when you arrive at or
            leave a job. When you clock out or start a break, sharing stops. Location trails are deleted after the
            period your company sets; your hours are kept for payroll.
          </p>
          <button type="button" className="btn-primary" disabled={pending} onClick={() => act(acceptTrackingNotice)}>
            I understand
          </button>
        </div>
      ) : state === "on" ? (
        <div className="tc-actions">
          <button type="button" className="btn-ghost tc-btn" disabled={pending} onClick={() => act(async () => startBreak(await currentFix()))}>
            Start break
          </button>
          <button type="button" className="btn-primary tc-btn" disabled={pending} onClick={() => act(async () => clockOut(await currentFix()))}>
            Clock out
          </button>
        </div>
      ) : (
        <>
          <button type="button" className="btn-primary tc-btn tc-btn-go" disabled={pending} onClick={() => act(async () => clockIn(await currentFix()))}>
            {state === "break" ? "Back from break" : "Clock in"}
          </button>
          <p className="hint-note">
            Allow location when your phone asks. In the CRM phone app, sharing keeps going with your phone locked;
            in a phone browser, only while the CRM is on screen.
          </p>
        </>
      )}
      {error && <p className="error-note">{error}</p>}

      {timeline.length > 0 && (
        <div className="tc-card">
          <div className="tc-caps">Today</div>
          {timeline.map((t, i) => (
            <div key={i} className="tc-line">
              <span>
                {clock(t.at, zone)} · {t.text}
              </span>
              {t.mins !== null && <span className="tc-mono">{duration(t.mins)}</span>}
            </div>
          ))}
        </div>
      )}

      {appointments.length > 0 && (
        <div className="tc-card">
          <div className="tc-caps">Today&apos;s schedule</div>
          {appointments.map((a) => (
            <div key={a.id} className="tc-line">
              <span>{a.title}</span>
              <span className="tc-mono">{a.start ? clock(a.start, zone) : "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
