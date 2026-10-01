"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptTrackingNotice, clockIn, clockOut, startBreak, type ClockInAnswer } from "@/lib/actions/time-clock";
import { punchMinutes, type PunchRow, type ShiftState } from "@/lib/time-clock/hours";
import { TIME_CLOCK_CHANGED, currentFix } from "@/lib/time-clock/client-location";
import { CLOCK_IN_REASONS, awayDistance, describeStamp } from "@/lib/time-clock/clock-in-check";
import type { ClockCheck } from "@/lib/time-clock/geo";

export type VisitRow = { id: string; label: string; arrived_at: string; left_at: string | null };

// Where each of today's punches started and ended (0185); empty before
// that migration runs.
export type PunchStampRow = {
  id: string;
  in_check: ClockCheck | null;
  in_place: string | null;
  in_distance_m: number | null;
  out_check: ClockCheck | null;
  out_place: string | null;
  out_distance_m: number | null;
};

type Fix = Awaited<ReturnType<typeof currentFix>>;
type Ask = { kind: "reason"; place: string; distance: string; fix: Fix } | { kind: "location" } | null;

// The card under the stopwatch once someone is on the clock: where the
// clock-in was checked, colored like the prompt that led to it. Nothing
// for an unchecked role.
const CARD_CLASS: Partial<Record<ClockCheck, string>> = { at_place: "tc-here", away: "tc-away", no_location: "tc-no-fix" };

function clockedInLine(s: PunchStampRow): string | null {
  if (s.in_check === "at_place") return `Clocked in at ${s.in_place}`;
  if (s.in_check === "away") return `Clocked in ${awayDistance(s.in_distance_m ?? 0)} from ${s.in_place}`;
  if (s.in_check === "no_location") return "Clocked in without a location";
  return null;
}

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
  stamps,
  visits,
  appointments,
}: {
  zone: string;
  usesClock: boolean;
  noticeAccepted: boolean;
  state: ShiftState;
  punches: PunchRow[];
  stamps: PunchStampRow[];
  visits: VisitRow[];
  appointments: { id: string; title: string; start: string | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [ask, setAsk] = useState<Ask>(null);
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");

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

  // Clock in, answering the location check if it asks. A fix taken for
  // the first try is reused with the answer, so the question and the
  // stamp are about the same spot.
  function goClockIn(fix?: Fix, answer: ClockInAnswer = {}) {
    setError("");
    startTransition(async () => {
      const at = fix === undefined ? await currentFix() : fix;
      const res = await clockIn(at, answer);
      if (res.needsReason) {
        setAsk({ kind: "reason", ...res.needsReason, fix: at });
        if (res.error) setError(res.error);
        return;
      }
      if (res.needsLocation) return setAsk({ kind: "location" });
      if (res.error) return setError(res.error);
      setAsk(null);
      setPick("");
      setNote("");
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
  const stampOf = new Map(stamps.map((st) => [st.id, st]));
  const openStamp = openPunch ? stampOf.get(openPunch.id) : undefined;
  const clockedInAt = openStamp ? clockedInLine(openStamp) : null;
  // " · at Smith" after a timeline line, when the punch was checked.
  const where = (check: ClockCheck | null | undefined, place: string | null | undefined, distanceM: number | null | undefined) => {
    if (check === undefined) return "";
    const text = describeStamp({ check, place: place ?? null, distanceM: distanceM ?? null });
    return text ? ` · ${text}` : "";
  };

  // One timeline: punches and arrivals, in time order.
  const timeline = [
    ...punches.flatMap((p) => {
      const st = stampOf.get(p.id);
      return [
        { at: p.clock_in, text: `Clocked in${where(st?.in_check, st?.in_place, st?.in_distance_m)}`, mins: null as number | null },
        ...(p.clock_out
          ? [
              {
                at: p.clock_out,
                text:
                  p.end_reason === "auto"
                    ? "Clocked out automatically"
                    : `${p.end_reason === "break" ? "Break" : "Clocked out"}${where(st?.out_check, st?.out_place, st?.out_distance_m)}`,
                mins: null,
              },
            ]
          : []),
      ];
    }),
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

      {state === "on" && !openVisit && openPunch && clockedInAt && (
        <div className={`tc-card ${CARD_CLASS[openStamp?.in_check ?? "away"] ?? "tc-away"}`}>
          <strong>{clockedInAt}</strong>
          <span className="tc-soft">{clock(openPunch.clock_in, zone)} · location checked</span>
        </div>
      )}

      {!noticeAccepted ? (
        <div className="tc-card tc-notice">
          <strong>Before your first clock-in</strong>
          <p>
            While you&apos;re on the clock, the office sees where you are every few minutes and when you arrive at or
            leave a job. Where you clock in and out is checked against your jobs for the day. When you clock out or
            start a break, sharing stops. Location trails are deleted after the
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
      ) : ask?.kind === "reason" ? (
        <div className="tc-card tc-away" role="group" aria-labelledby="tc-ask-title">
          <strong id="tc-ask-title">
            You&apos;re {ask.distance} from {ask.place}
          </strong>
          <p className="tc-soft">
            Nothing on your schedule today is closer. Clocking in here shows on your timesheet. What are you doing?
          </p>
          <div className="tc-picks">
            {CLOCK_IN_REASONS.map((r) => (
              <button key={r} type="button" className="tc-pick" aria-pressed={pick === r} onClick={() => setPick(r)}>
                {r}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="field-label">{pick === "Something else" ? "What are you doing?" : "Details (optional)"}</span>
            <input
              id="tc-ask-note"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              placeholder={pick === "Something else" ? "A few words" : "ABC Supply, shingles for Smith"}
            />
          </label>
          <div className="tc-actions">
            <button type="button" className="btn-ghost tc-btn" disabled={pending} onClick={() => setAsk(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary tc-btn"
              disabled={pending || !pick}
              onClick={() => goClockIn(ask.fix, { pick, note })}
            >
              Clock in anyway
            </button>
          </div>
        </div>
      ) : ask?.kind === "location" ? (
        <div className="tc-card tc-no-fix">
          <strong>Couldn&apos;t get your location</strong>
          <p className="tc-soft">
            Turn on location for the CRM, or step outside and try again. You can still clock in, and it will show as
            &ldquo;No location&rdquo; on your timesheet.
          </p>
          <div className="tc-actions">
            <button type="button" className="btn-ghost tc-btn" disabled={pending} onClick={() => goClockIn()}>
              Try again
            </button>
            <button type="button" className="btn-primary tc-btn" disabled={pending} onClick={() => goClockIn(null, { withoutLocation: true })}>
              Clock in anyway
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="btn-primary tc-btn tc-btn-go" disabled={pending} onClick={() => goClockIn()}>
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
