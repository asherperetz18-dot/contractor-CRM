import type { ReactNode } from "react";

export type HBarRow = {
  key: string;
  label: ReactNode;
  /** 0..1 of the widest bar in the panel. */
  frac: number;
  color: string;
  right: ReactNode;
};

/**
 * Labeled horizontal bars -- the dashboard's workhorse: funnel, stages,
 * sources, receivables. Every row carries its number directly, so the
 * bars are comparison, never the only way to read a value.
 */
export function HBarRows({ rows }: { rows: HBarRow[] }) {
  return (
    <div className="dash-hbars">
      {rows.map((r) => (
        <div key={r.key} className="dash-hbar-row">
          <span className="dash-hbar-label">{r.label}</span>
          <span className="dash-hbar-track">
            <span
              className="dash-hbar-fill"
              style={{ width: `${Math.max(0, Math.min(1, r.frac)) * 100}%`, background: r.color }}
            />
          </span>
          <span className="dash-hbar-num mono">{r.right}</span>
        </div>
      ))}
    </div>
  );
}
