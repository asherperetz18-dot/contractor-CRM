"use client";

import { useTimeFormat } from "@/components/time-format-context";
import { formatTimeRange, type Event } from "@/lib/data/types";

function formatEventDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function UpcomingAppointments({ events }: { events: Event[] }) {
  const timeFormat = useTimeFormat();

  if (!events.length) return <p className="empty-hint">Nothing scheduled.</p>;

  return (
    <ul className="dash-list">
      {events.map((ev) => (
        <li key={ev.id}>
          <span className="mono">
            {formatEventDate(ev.date)}
            {ev.time ? ` · ${formatTimeRange(ev.time, ev.end_time, timeFormat)}` : ""}
          </span>
          <span style={{ flex: 1 }}>{ev.title}</span>
        </li>
      ))}
    </ul>
  );
}
