"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  EVENT_STATUS_COLOR,
  formatTimeRange,
  hasAppointmentResult,
  type EventStatus,
  type Profile,
} from "@/lib/data/types";
import { getAppointmentsForLead, type LeadAppointmentRow } from "@/lib/actions/events";

function longDate(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return isNaN(d.getTime())
    ? day
    : d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

/**
 * Every visit booked on this contact, past and future.
 *
 * The contact card had no way to see them at all. The only hint was a
 * "Has Appointment?" dropdown somebody sets by hand, which can read
 * "Scheduled" with nothing booked and "Not yet" with three on the
 * calendar -- so the one place you would go to check was the one place
 * that could be wrong.
 *
 * Split rather than sorted into one run, because the two halves answer
 * different questions: what is coming, and what came of the last one.
 */
export function LeadAppointmentsPanel({
  leadId,
  reps,
}: {
  leadId: string;
  reps: Profile[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [rows, setRows] = useState<LeadAppointmentRow[] | null>(null);
  const [error, setError] = useState("");
  // Fixed at mount: "today" moving mid-session would shuffle a row from
  // one list to the other under the reader.
  const [todayISO] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getAppointmentsForLead(leadId);
      if (cancelled) return;
      if (result.error) setError(result.error);
      else setRows(result.appointments ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  /**
   * Where to come back to once the appointment closes.
   *
   * The contact reopens on Contacts, which reads openLead. Elsewhere the
   * param is ignored and you land back on the page you started from --
   * still better than being left on the calendar wondering where the
   * customer went.
   */
  function openAppointment(eventId: string) {
    const back = `${pathname}?openLead=${leadId}`;
    router.push(`/calendar?openEvent=${eventId}&from=${encodeURIComponent(back)}`);
  }

  function repName(id: string | null) {
    if (!id) return "Unassigned";
    const r = reps.find((p) => p.id === id);
    return r?.name || r?.email || "Unknown";
  }

  if (error) return <p className="empty-hint">{error}</p>;
  if (rows === null) return <p className="empty-hint">Loading appointments…</p>;

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-label">No appointments yet</p>
        <p className="empty-hint">
          Every visit booked for this contact appears here, upcoming and past.
        </p>
      </div>
    );
  }

  const upcoming = rows.filter((e) => e.date >= todayISO).sort((a, b) => a.date.localeCompare(b.date));
  const past = rows.filter((e) => e.date < todayISO);

  function table(list: LeadAppointmentRow[], showOutcome: boolean) {
    return (
      <table className="data-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Type</th>
            <th>Who</th>
            <th>{showOutcome ? "Outcome" : "Status"}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((e) => (
            // Straight to the appointment, and back here on close. The
            // outcome is recorded on the appointment itself, so this
            // links to it rather than growing a second result form that
            // would have to be kept in step with the first.
            <tr key={e.id} className="row-link" onClick={() => openAppointment(e.id)}>
              <td>
                {longDate(e.date)}
                {e.time && (
                  <div className="empty-hint">
                    {formatTimeRange(e.time, e.end_time, "12h", "–")}
                  </div>
                )}
              </td>
              <td>{e.event_type}</td>
              <td>
                {repName(e.assigned_to)}
                {e.second_assigned_to && (
                  <div className="empty-hint">+ {repName(e.second_assigned_to)}</div>
                )}
              </td>
              <td>
                {/* A past visit with nothing recorded is the thing worth
                    seeing: it is what quietly drags the show rate down,
                    because it counts neither way. */}
                {showOutcome && !hasAppointmentResult(e.status as EventStatus) ? (
                  <span className="empty-hint">No result recorded</span>
                ) : (
                  <Badge color={EVENT_STATUS_COLOR[e.status as EventStatus] ?? "gray"}>
                    {e.status}
                  </Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div>
      {upcoming.length > 0 && (
        <>
          <p className="field-label">Upcoming ({upcoming.length})</p>
          {table(upcoming, false)}
        </>
      )}
      {past.length > 0 && (
        <>
          <p className="field-label" style={{ marginTop: upcoming.length ? 18 : 0 }}>
            Past ({past.length})
          </p>
          {table(past, true)}
        </>
      )}
    </div>
  );
}
