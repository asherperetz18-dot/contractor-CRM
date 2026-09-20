import { mergeSavedOrder } from "./funnel-order.ts";

/**
 * The dashboard's draggable boxes: which panels exist, and how a saved
 * per-person order reconciles with the shipped set.
 *
 * Persistence is the estimates funnel's exact pattern (DECISIONS #010):
 * `profiles.dashboard_panel_order text[]` (migration 0162) written by
 * its owner, with the browser's localStorage as the pre-migration path
 * and fallback. mergeSavedOrder does the reconciliation, so a panel
 * added in a later release appears at its shipped spot and a removed
 * one vanishes without wrecking the arrangement.
 */

export type DashboardPanelKey =
  | "sales-cash"
  | "funnel"
  | "stages"
  | "sources"
  | "aging"
  | "team"
  | "calls"
  | "production"
  | "recent-leads"
  | "appointments";

export type DashboardPanelDef = {
  key: DashboardPanelKey;
  title: string;
  /** Spans the full grid width. */
  wide?: boolean;
  /** Company money -- rendered only for canViewFinancials, same gate as Payments. */
  financial?: boolean;
};

export const DASHBOARD_PANELS: DashboardPanelDef[] = [
  { key: "sales-cash", title: "Sales vs. cash collected", wide: true, financial: true },
  { key: "funnel", title: "Sales funnel" },
  { key: "stages", title: "Pipeline value by stage" },
  { key: "sources", title: "Leads by source" },
  { key: "aging", title: "Money to collect", financial: true },
  { key: "team", title: "Team" },
  { key: "calls", title: "Call activity" },
  { key: "production", title: "Production" },
  { key: "recent-leads", title: "Recent leads" },
  { key: "appointments", title: "Upcoming appointments" },
];

export const DASHBOARD_PANEL_KEYS: readonly string[] = DASHBOARD_PANELS.map((p) => p.key);

/**
 * A saved order, made safe to render from: junk and duplicates dropped
 * first (a browser key can hold anything), then reconciled against the
 * panels this build actually ships.
 */
export function mergePanelOrder(saved?: readonly string[] | null): DashboardPanelKey[] {
  const deduped = [...new Set((saved ?? []).filter((k): k is string => typeof k === "string"))];
  return mergeSavedOrder(DASHBOARD_PANEL_KEYS, deduped) as DashboardPanelKey[];
}
