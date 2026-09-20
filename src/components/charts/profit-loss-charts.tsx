"use client";

import { useState } from "react";
import { moneyTickLabel, signedTicks } from "@/lib/charts/scale";
import { moneyCents } from "@/lib/data/types";
import type { PLJobBarRow, PLMonth } from "@/lib/data/profit-loss";

/**
 * The Profit & Loss graphs. Three views of the one statement:
 *
 *   PLMonthlyChart  -- month by month: income and spend as bars, net
 *                      profit as a line, on one dollar axis.
 *   PLWaterfall     -- income stepping down through job costs and
 *                      overhead to what was left.
 *   PLJobBars       -- each job's income split into what it cost and
 *                      what it made.
 *
 * One color per idea across all three: blue is money in, orange is
 * money out, green is what was kept, red only for a genuine loss (the
 * statement's own rule -- an expense is money doing its job, never
 * red). Validated for color-blind separation on the white card: the
 * green/orange pair sits in the warn band, so every chart also carries
 * a legend, direct labels or a 2px surface gap between fills, and the
 * line is a different mark from the bars.
 */

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(month: string): { name: string; year: string } {
  const [y, m] = month.split("-").map(Number);
  return { name: MONTH_NAMES[(m || 1) - 1] ?? month, year: `'${String(y).slice(2)}` };
}

/**
 * A column from one dollar level to another, rounded 4px at its data
 * end and square at the other. `end` says which edge carries the value:
 * a bar growing up from zero rounds its top; a cost stepping down from
 * the income line rounds its bottom; a loss falling below zero rounds
 * its bottom too.
 */
function column(x0: number, w: number, yA: number, yB: number, end: "top" | "bottom"): string {
  const top = Math.min(yA, yB);
  const base = Math.max(yA, yB);
  const r = 4;
  if (base - top < r) return `M${x0},${base} h${w} v${-(base - top)} h${-w} Z`;
  if (end === "top") {
    return [
      `M${x0},${base}`,
      `L${x0},${top + r}`,
      `Q${x0},${top} ${x0 + r},${top}`,
      `L${x0 + w - r},${top}`,
      `Q${x0 + w},${top} ${x0 + w},${top + r}`,
      `L${x0 + w},${base}`,
      "Z",
    ].join(" ");
  }
  return [
    `M${x0},${top}`,
    `L${x0},${base - r}`,
    `Q${x0},${base} ${x0 + r},${base}`,
    `L${x0 + w - r},${base}`,
    `Q${x0 + w},${base} ${x0 + w},${base - r}`,
    `L${x0 + w},${top}`,
    "Z",
  ].join(" ");
}

// ── Month by month ───────────────────────────────────────────────────

export function PLMonthlyChart({ months }: { months: PLMonth[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const H = 250;
  const m = { top: 14, right: 12, bottom: 32, left: 54 };
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;

  const spend = (x: PLMonth) => x.jobCostCents + x.overheadCents;
  const peak = Math.max(0, ...months.map((x) => Math.max(x.incomeCents, spend(x), x.netCents)));
  const trough = Math.min(0, ...months.map((x) => x.netCents));
  const { floor, top, ticks } = signedTicks(trough, peak);
  const y = (v: number) => m.top + ph - ((v - floor) / (top - floor || 1)) * ph;
  const zero = y(0);
  const bandW = pw / Math.max(1, months.length);
  const bandX = (i: number) => m.left + (i + 0.5) * bandW;
  // Two bars per month, each capped at 14px, a 2px surface gap between.
  const barW = Math.max(3, Math.min(14, Math.floor(bandW * 0.3)));
  const gap = 2;

  const linePts = months.map((x, i) => [bandX(i), y(x.netCents)] as const);
  const hovered = hover === null ? null : months[hover];

  return (
    <div className="dash-chart-wrap">
      <div className="dash-chart-scroll">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="dash-chart"
          role="img"
          aria-label="Income, spend and net profit by month"
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
                {t < 0 ? `−${moneyTickLabel(-t)}` : moneyTickLabel(t)}
              </text>
            </g>
          ))}
          {hover !== null && (
            <rect
              x={m.left + hover * bandW}
              y={m.top}
              width={bandW}
              height={ph}
              fill="var(--pl-hover-band)"
            />
          )}
          {months.map((x, i) => (
            <g key={x.month}>
              {x.incomeCents > 0 && (
                <path
                  d={column(bandX(i) - barW - gap / 2, barW, zero, y(x.incomeCents), "top")}
                  fill="var(--pl-income)"
                />
              )}
              {spend(x) > 0 && (
                <path
                  d={column(bandX(i) + gap / 2, barW, zero, y(spend(x)), "top")}
                  fill="var(--pl-spend)"
                />
              )}
            </g>
          ))}
          {months.map((x, i) => {
            const { name, year } = monthLabel(x.month);
            const first = i === 0 || name === "Jan";
            // Past two years of months, every other label would collide.
            const dense = months.length > 18;
            if (dense && i % 2 === 1 && !first) return null;
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
            stroke="var(--pl-profit)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {linePts.map(([x, py], i) => (
            <g key={`d-${months[i].month}`}>
              <circle cx={x} cy={py} r={6} fill="var(--dash-surface)" />
              <circle
                cx={x}
                cy={py}
                r={4}
                fill={months[i].netCents < 0 ? "var(--pl-loss)" : "var(--pl-profit)"}
              />
            </g>
          ))}
          {/* Whole-month hover/focus bands: a big target, one tooltip
              for every series. */}
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
            {monthLabel(hovered.month).name} {monthLabel(hovered.month).year} — Income{" "}
            <b>{moneyTickLabel(hovered.incomeCents)}</b> · Job costs{" "}
            <b>{moneyTickLabel(hovered.jobCostCents)}</b> · Overhead{" "}
            <b>{moneyTickLabel(hovered.overheadCents)}</b> · Net{" "}
            <b className={hovered.netCents < 0 ? "pl-neg" : ""}>
              {hovered.netCents < 0 ? "−" : ""}
              {moneyTickLabel(Math.abs(hovered.netCents))}
            </b>
          </div>
        )}
      </div>
      {/* The chart's table twin: every value reachable without a mouse. */}
      <table className="sr-only">
        <caption>Income, spend and net profit by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Income</th>
            <th scope="col">Job costs</th>
            <th scope="col">Overhead</th>
            <th scope="col">Net profit</th>
          </tr>
        </thead>
        <tbody>
          {months.map((x) => (
            <tr key={x.month}>
              <th scope="row">{x.month}</th>
              <td>{moneyCents(x.incomeCents)}</td>
              <td>{moneyCents(x.jobCostCents)}</td>
              <td>{moneyCents(x.overheadCents)}</td>
              <td>{moneyCents(x.netCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Where the money went ─────────────────────────────────────────────

export function PLWaterfall({
  incomeCents,
  jobCostCents,
  overheadCents,
  netProfitCents,
}: {
  incomeCents: number;
  jobCostCents: number;
  overheadCents: number;
  netProfitCents: number;
}) {
  const gross = incomeCents - jobCostCents;
  const steps = [
    { key: "income", label: "Income", from: 0, to: incomeCents, color: "var(--pl-income)" },
    { key: "costs", label: "Job costs", from: incomeCents, to: gross, color: "var(--pl-spend)" },
    { key: "overhead", label: "Overhead", from: gross, to: netProfitCents, color: "var(--pl-spend)" },
    {
      key: "net",
      label: "Net profit",
      from: 0,
      to: netProfitCents,
      color: netProfitCents < 0 ? "var(--pl-loss)" : "var(--pl-profit)",
    },
  ];

  const W = 380;
  const H = 230;
  const m = { top: 26, right: 8, bottom: 30, left: 54 };
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;
  const peak = Math.max(0, incomeCents, gross, netProfitCents);
  const trough = Math.min(0, gross, netProfitCents);
  const { floor, top, ticks } = signedTicks(trough, peak);
  const y = (v: number) => m.top + ph - ((v - floor) / (top - floor || 1)) * ph;
  const bandW = pw / steps.length;
  const bandX = (i: number) => m.left + (i + 0.5) * bandW;
  const colW = Math.min(44, Math.floor(bandW * 0.55));
  const share = (v: number) => `${((v / incomeCents) * 100).toFixed(1)}% of income`;
  const shareShort = (v: number) => `${((v / incomeCents) * 100).toFixed(1)}%`;
  const signed = (v: number) => (v < 0 ? `−${moneyTickLabel(-v)}` : moneyTickLabel(v));

  return (
    <div className="dash-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="pl-waterfall" role="img" aria-label="Income to net profit">
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
              {signed(t)}
            </text>
          </g>
        ))}
        {/* Connectors: the level each step lands on, carried to the next. */}
        {steps.slice(0, -1).map((s, i) => (
          <line
            key={`c-${s.key}`}
            x1={bandX(i) + colW / 2}
            x2={bandX(i + 1) - colW / 2}
            y1={y(s.to)}
            y2={y(s.to)}
            stroke="var(--dash-axis)"
            strokeWidth={1}
          />
        ))}
        {steps.map((s, i) => {
          const value = s.key === "income" || s.key === "net" ? s.to : s.from - s.to;
          const drop = s.key === "costs" || s.key === "overhead";
          const empty = s.from === s.to;
          const labelY = Math.min(y(s.from), y(s.to)) - 6;
          return (
            <g key={s.key}>
              {!empty && (
                <path
                  d={column(
                    bandX(i) - colW / 2,
                    colW,
                    y(s.from),
                    y(s.to),
                    drop || s.to < 0 ? "bottom" : "top"
                  )}
                  fill={s.color}
                />
              )}
              <text x={bandX(i)} y={labelY} textAnchor="middle" className="pl-wf-value">
                {drop ? (value > 0 ? `−${moneyTickLabel(value)}` : "$0") : signed(value)}
              </text>
              <text x={bandX(i)} y={H - m.bottom + 17} textAnchor="middle" className="dash-chart-month">
                {s.label}
              </text>
              {s.key !== "income" && incomeCents > 0 && (
                <text x={bandX(i)} y={H - m.bottom + 28} textAnchor="middle" className="dash-chart-year">
                  {shareShort(drop ? value : s.to)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Income to net profit</caption>
        <tbody>
          <tr>
            <th scope="row">Income</th>
            <td>{moneyCents(incomeCents)}</td>
          </tr>
          <tr>
            <th scope="row">Job costs</th>
            <td>
              {moneyCents(jobCostCents)}
              {incomeCents > 0 && ` (${share(jobCostCents)})`}
            </td>
          </tr>
          <tr>
            <th scope="row">Overhead</th>
            <td>
              {moneyCents(overheadCents)}
              {incomeCents > 0 && ` (${share(overheadCents)})`}
            </td>
          </tr>
          <tr>
            <th scope="row">Net profit</th>
            <td>
              {moneyCents(netProfitCents)}
              {incomeCents > 0 && ` (${share(netProfitCents)})`}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Profit by job ────────────────────────────────────────────────────

export function PLJobBars({ rows }: { rows: PLJobBarRow[] }) {
  const widest = Math.max(1, ...rows.map((r) => Math.max(r.incomeCents, r.costCents)));
  return (
    <div className="dash-hbars pl-jobbars">
      {rows.map((r) => {
        const profit = r.incomeCents - r.costCents;
        const loss = profit < 0;
        const margin =
          r.incomeCents > 0 ? `${((profit / r.incomeCents) * 100).toFixed(1)}%` : "—";
        const tip = `${r.label}: income ${moneyCents(r.incomeCents)}, costs ${moneyCents(
          r.costCents
        )}, profit ${moneyCents(profit)}`;
        return (
          <div key={r.key} className="dash-hbar-row" title={tip}>
            <span className="dash-hbar-label">{r.label}</span>
            <span className="dash-hbar-track">
              {r.costCents > 0 && (
                <span
                  className={"dash-hbar-fill pl-hbar-cost" + (loss ? " pl-hbar-only" : "")}
                  style={{ width: `${(r.costCents / widest) * 100}%` }}
                />
              )}
              {profit > 0 && (
                <span
                  className="dash-hbar-fill pl-hbar-profit"
                  style={{ width: `${(profit / widest) * 100}%` }}
                />
              )}
            </span>
            <span className={"dash-hbar-num mono" + (loss ? " pl-neg" : "")}>
              {moneyCents(profit)} <small>{margin}</small>
            </span>
          </div>
        );
      })}
    </div>
  );
}
