"use client";

import { useState } from "react";
import { moneyTickLabel, niceTicks } from "@/lib/charts/scale";

export type MonthlyMoneyPoint = { month: string; signedCents: number; collectedCents: number };

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(month: string): { name: string; year: string } {
  const [y, m] = month.split("-").map(Number);
  return { name: MONTH_NAMES[(m || 1) - 1] ?? month, year: `'${String(y).slice(2)}` };
}

/**
 * Contracts signed (bars) against cash collected (line), by month, on
 * one dollar axis. The gap between the two is money sold but not yet
 * banked. Hovering (or tabbing) a month shows both figures; the same
 * numbers live in a visually-hidden table so nothing is hover-only.
 */
export function MonthlyMoney({ months }: { months: MonthlyMoneyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const H = 250;
  const m = { top: 14, right: 12, bottom: 32, left: 50 };
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;

  const peak = Math.max(0, ...months.map((x) => Math.max(x.signedCents, x.collectedCents)));
  const { max, ticks } = niceTicks(peak);
  const y = (v: number) => m.top + ph - (v / max) * ph;
  const bandW = pw / Math.max(1, months.length);
  const bandX = (i: number) => m.left + (i + 0.5) * bandW;

  const barW = 15;
  const r = 4;
  // Rounded at the data end only; square on the baseline.
  const barPath = (i: number, v: number) => {
    const x0 = bandX(i) - barW / 2;
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

  const linePts = months.map((x, i) => [bandX(i), y(x.collectedCents)] as const);
  const hovered = hover === null ? null : months[hover];

  return (
    <div className="dash-chart-wrap">
      <div className="dash-chart-scroll">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="dash-chart"
          role="img"
          aria-label="Contracts signed and cash collected by month"
        >
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
              <text x={m.left - 8} y={y(t) + 4} textAnchor="end" className="dash-chart-tick">
                {moneyTickLabel(t)}
              </text>
            </g>
          ))}
          {months.map((x, i) => (
            <path key={x.month} d={barPath(i, x.signedCents)} fill="var(--dash-chart-blue)" />
          ))}
          {months.map((x, i) => {
            const { name, year } = monthLabel(x.month);
            const first = i === 0 || name === "Jan";
            return (
              <g key={`l-${x.month}`}>
                <text x={bandX(i)} y={H - m.bottom + 17} textAnchor="middle" className="dash-chart-month">
                  {name}
                </text>
                {first && (
                  <text x={bandX(i)} y={H - m.bottom + 29} textAnchor="middle" className="dash-chart-year">
                    {year}
                  </text>
                )}
              </g>
            );
          })}
          <polyline
            points={linePts.map(([x, py]) => `${x.toFixed(1)},${py.toFixed(1)}`).join(" ")}
            fill="none"
            stroke="var(--dash-chart-green)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {linePts.map(([x, py], i) => (
            <g key={`d-${months[i].month}`}>
              <circle cx={x} cy={py} r={6} fill="var(--dash-surface)" />
              <circle cx={x} cy={py} r={4} fill="var(--dash-chart-green)" />
            </g>
          ))}
          {/* Whole-month hover/focus bands: a big target, one tooltip
              for both series. */}
          {months.map((x, i) => (
            <rect
              key={`h-${x.month}`}
              x={m.left + i * bandW}
              y={m.top}
              width={bandW}
              height={ph + 20}
              fill="transparent"
              tabIndex={0}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((cur) => (cur === i ? null : cur))}
              onFocus={() => setHover(i)}
              onBlur={() => setHover((cur) => (cur === i ? null : cur))}
            />
          ))}
        </svg>
        {hovered && hover !== null && (
          <div
            className="dash-chart-tip"
            style={{
              left: `${(bandX(hover) / W) * 100}%`,
              transform: `translateX(${hover <= 1 ? "0" : hover >= months.length - 2 ? "-100%" : "-50%"})`,
            }}
          >
            {monthLabel(hovered.month).name} {monthLabel(hovered.month).year} — Signed{" "}
            <b>{moneyTickLabel(hovered.signedCents)}</b> · Collected{" "}
            <b>{moneyTickLabel(hovered.collectedCents)}</b>
          </div>
        )}
      </div>
      {/* The chart's table twin: every value reachable without a mouse. */}
      <table className="sr-only">
        <caption>Contracts signed and cash collected by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Contracts signed</th>
            <th scope="col">Cash collected</th>
          </tr>
        </thead>
        <tbody>
          {months.map((x) => (
            <tr key={x.month}>
              <th scope="row">{x.month}</th>
              <td>{moneyTickLabel(x.signedCents)}</td>
              <td>{moneyTickLabel(x.collectedCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
