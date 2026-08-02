"use client";

import { useTimeFormat } from "@/components/time-format-context";
import type { Event, TimeFormat } from "@/lib/data/types";

function formatEventTime(time: string | null, format: TimeFormat): string {
  if (!time) return "";
  const hhmm = time.slice(0, 5);
  if (format === "24h") return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

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
            {ev.time ? ` · ${formatEventTime(ev.time, timeFormat)}` : ""}
          </span>
          <span style={{ flex: 1 }}>{ev.title}</span>
        </li>
      ))}
    </ul>
  );
}
