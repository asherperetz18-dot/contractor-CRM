"use client";

import { useState } from "react";
import { niceTicks } from "@/lib/charts/scale";

export type WeekPoint = { week: string; value: number; detail?: string };

function weekLabel(week: string): string {
  return new Date(`${week}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * One count per week as thin columns on a single axis -- Marketing
 * Analytics' twelve-week strips. The peak and the week in progress carry
 * their number; the axis, the hover readout and a visually-hidden table
 * carry the rest, so nothing is hover-only. The current week is drawn a
 * step lighter because it is not finished.
 */
export function WeekColumns({
  points,
  color,
  lightColor,
  unit,
  label,
}: {
  points: WeekPoint[];
  color: string;
  lightColor: string;
  unit: string;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 430;
  const H = 150;
  const m = { top: 14, right: 8, bottom: 22, left: 40 };
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;

  const peak = Math.max(0, ...points.map((p) => p.value));
  const { max, ticks } = niceTicks(peak, 2);
  const y = (v: number) => m.top + ph - (v / max) * ph;
  const bandW = pw / Math.max(1, points.length);
  const barW = Math.min(24, bandW * 0.62);
  const r = 4;
  // Rounded at the data end only; square on the baseline.
  const barPath = (cx: number, v: number) => {
    const x0 = cx - barW / 2;
    const top = y(v);
    const base = y(0);
    if (base - top < r) return `M${x0},${base} h${barW} v${-(base - top)} h${-barW} Z`;
    return [
      `M${x0},${base}`,
      `L${x0},${top + r}`,
      `Q${x0},${top} ${x0 + r},${top}`,
      `L${x0 + barW - r},${top}`,
      `Q${x0 + barW},${top} ${x0 + barW},${top + r}`,
      `L${x0 + barW},${base}`,
      "Z",
    ].join(" ");
  };
  const maxI = points.reduce((best, p, i) => (p.value > (points[best]?.value ?? -1) ? i : best), 0);
  const last = points.length - 1;
  const fmt = (v: number) => v.toLocaleString("en-US");
  const hovered = hover === null ? null : points[hover];

  return (
    <div className="dash-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="mkt-chart" role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={m.left}
              x2={W - m.right}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? "var(--dash-axis)" : "var(--dash-grid)"}
              strokeWidth={1}
            />
            <text x={m.left - 6} y={y(t) + 3.5} textAnchor="end" className="dash-chart-tick">
              {fmt(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = m.left + (i + 0.5) * bandW;
          const isLast = i === last;
          return (
            <g
              key={p.week}
              className="mkt-col"
              tabIndex={0}
              aria-label={`Week of ${weekLabel(p.week)}: ${fmt(p.value)} ${unit}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((cur) => (cur === i ? null : cur))}
              onFocus={() => setHover(i)}
              onBlur={() => setHover((cur) => (cur === i ? null : cur))}
            >
              {/* The whole band is the hit target, never the bar alone. */}
              <rect x={m.left + i * bandW} y={m.top} width={bandW} height={ph} fill="transparent" />
              {p.value > 0 && (
                <path
                  d={barPath(cx, p.value)}
                  fill={isLast ? lightColor : color}
                  opacity={hover === i ? 0.75 : 1}
                />
              )}
              {(i === maxI || isLast) && p.value > 0 && (
                <text
                  x={cx}
                  y={y(p.value) - 4}
                  textAnchor="middle"
                  className={"mkt-cap" + (isLast && i !== maxI ? " is-soft" : "")}
                >
                  {fmt(p.value)}
                </text>
              )}
              {(i % 2 === 0 || isLast) && (
                <text x={cx} y={H - 6} textAnchor="middle" className="dash-chart-month">
                  {isLast ? "now" : weekLabel(p.week)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && hover !== null && (
        <div
          className="dash-chart-tip mkt-tip"
          style={{ left: `${((m.left + (hover + 0.5) * bandW) / W) * 100}%` }}
        >
          <b>{fmt(hovered.value)}</b> {unit}
          {hovered.detail ? ` · ${hovered.detail}` : ""} · week of {weekLabel(hovered.week)}
          {hover === last ? " (in progress)" : ""}
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>Week of</th>
            <th>{unit}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.week}>
              <td>{weekLabel(p.week)}</td>
              <td>{fmt(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
