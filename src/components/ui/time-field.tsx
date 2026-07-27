"use client";

import { useTimeFormat } from "@/components/time-format-context";

const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

function parse24h(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(":").map((n) => parseInt(n, 10));
  return { hour: isNaN(h) ? 0 : h, minute: isNaN(m) ? 0 : m };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function TimeField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const format = useTimeFormat();
  const { hour, minute } = parse24h(value);

  if (format === "24h") {
    return (
      <input type="time" value={value.slice(0, 5)} onChange={(e) => onChange(e.target.value)} />
    );
  }

  const isPM = hour >= 12;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const roundedMinute = MINUTES.includes(minute) ? minute : Math.round(minute / 5) * 5 || 0;

  function setParts(nextHour12: number, nextMinute: number, nextIsPM: boolean) {
    const nextHour24 = nextIsPM ? (nextHour12 % 12) + 12 : nextHour12 % 12;
    onChange(`${pad(nextHour24)}:${pad(nextMinute)}`);
  }

  return (
    <div className="time-field-row">
      <select
        value={hour12}
        onChange={(e) => setParts(Number(e.target.value), roundedMinute, isPM)}
      >
        {HOURS_12.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="time-field-colon">:</span>
      <select
        value={roundedMinute}
        onChange={(e) => setParts(hour12, Number(e.target.value), isPM)}
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {pad(m)}
          </option>
        ))}
      </select>
      <select
        value={isPM ? "PM" : "AM"}
        onChange={(e) => setParts(hour12, roundedMinute, e.target.value === "PM")}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
