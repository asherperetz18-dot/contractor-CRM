import { daysSince, isSettledStage } from "./data/types.ts";

/**
 * The pipeline board's stat tiles, computed server-side from a slim
 * scan of the book (a handful of columns, never notes) instead of in
 * the browser from every full lead row. Pure so the arithmetic -- which
 * must keep matching what the in-browser reduction produced -- is
 * testable without a database.
 */

/** The columns the aggregates need; the scan selects exactly these. */
export type BoardSlimLead = {
  stage: string;
  value: number;
  has_appt: boolean;
  date_received: string;
};

export type BoardAggregates = {
  pipelineValue: number;
  avgDealSize: number;
  /** Open leads whose value is 0/blank -- in the average's denominator, adding nothing. */
  leadsWithNoValue: number;
  wonValue: number;
  wonCount: number;
  wonNoValueCount: number;
  staleCount: number;
  noApptCount: number;
  valueByStage: { stage: string; count: number; value: number }[];
  openCount: number;
};

export function computeBoardAggregates(slim: BoardSlimLead[]): BoardAggregates {
  let pipelineValue = 0;
  let leadsWithNoValue = 0;
  let wonValue = 0;
  let wonCount = 0;
  let wonNoValueCount = 0;
  let staleCount = 0;
  let noApptCount = 0;
  let openCount = 0;
  const byStage = new Map<string, { count: number; value: number }>();

  for (const l of slim) {
    const value = Number(l.value) || 0;
    if (l.stage === "Won") {
      wonCount += 1;
      wonValue += value;
      if (!value) wonNoValueCount += 1;
      continue;
    }
    if (isSettledStage(l.stage)) continue;

    openCount += 1;
    pipelineValue += value;
    if (!value) leadsWithNoValue += 1;
    if (daysSince(l.date_received) > 14) staleCount += 1;
    if (!l.has_appt) noApptCount += 1;
    const row = byStage.get(l.stage) ?? { count: 0, value: 0 };
    row.count += 1;
    row.value += value;
    byStage.set(l.stage, row);
  }

  const valueByStage = [...byStage.entries()]
    .map(([stage, row]) => ({ stage, ...row }))
    .sort((a, b) => b.value - a.value || b.count - a.count);

  return {
    pipelineValue,
    avgDealSize: openCount ? pipelineValue / openCount : 0,
    leadsWithNoValue,
    wonValue,
    wonCount,
    wonNoValueCount,
    staleCount,
    noApptCount,
    valueByStage,
    openCount,
  };
}
