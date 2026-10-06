import type { SmsMessage } from "./data/types.ts";
import { addDays } from "./schedule-window.ts";

/**
 * Which texts Text Reports loads (DECISIONS #146).
 *
 * The period rides in the address (`?range=90`, or `?from=…&to=…` for a
 * custom range) and the server loads only that window -- this page used
 * to load every text the company ever sent or received, every column,
 * and filter in the browser. The report still applies its own exact
 * filter on the browser's own "today"; the server only knows the UTC
 * date, which can be a day either side of it, so a "last N days" window
 * starts a day earlier on the server. Custom dates are absolute and
 * loaded exactly. Pure, so the page, the view and the tests share it.
 */

export const TEXT_REPORT_PRESETS = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
  { key: "all", label: "All time" },
] as const;
export type TextReportPreset = (typeof TEXT_REPORT_PRESETS)[number]["key"];

const DEFAULT_PRESET: TextReportPreset = "30";

/** Rows the table draws at a time. The numbers above it count every text in the period. */
export const TEXT_REPORT_ROWS = 200;

export type TextReportQuery = {
  preset: TextReportPreset;
  /** A custom range's ends (inclusive); null where not set. Set dates win over the preset. */
  from: string | null;
  to: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day from year 1000 on: "2026-02-31" and a half-typed "0002-01-15" are not. */
function day(v: unknown): string | null {
  return typeof v === "string" && DAY.test(v) && v >= "1000" && addDays(v, 0) === v ? v : null;
}

/** The address's query, kept only where it is what it should be; the default otherwise. */
export function parseTextReportQuery(p: { range?: unknown; from?: unknown; to?: unknown }): TextReportQuery {
  const preset = TEXT_REPORT_PRESETS.find((x) => x.key === p.range)?.key ?? DEFAULT_PRESET;
  return { preset, from: day(p.from), to: day(p.to) };
}

/** The query for the address: "" for the default, else "?…" with only what differs. */
export function textReportQueryString(q: TextReportQuery): string {
  const params = new URLSearchParams();
  if (q.preset !== DEFAULT_PRESET) params.set("range", q.preset);
  if (q.from) params.set("from", q.from);
  if (q.to) params.set("to", q.to);
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** The query as the date filter's own state ("" for an unset date). */
export function textReportRange(q: TextReportQuery): { preset: string; from: string; to: string } {
  return { preset: q.preset, from: q.from ?? "", to: q.to ?? "" };
}

/**
 * What the server loads for a query, as inclusive days (null is open):
 * every text the report could count for any "today" a day either side of
 * the UTC date.
 */
export function textReportServerWindow(q: TextReportQuery, utcToday: string): { lo: string | null; hi: string | null } {
  if (q.from || q.to) return { lo: q.from, hi: q.to };
  if (q.preset === "all") return { lo: null, hi: null };
  return { lo: addDays(utcToday, -(Number(q.preset) + 1)), hi: null };
}

/**
 * What the report reads of each text -- the select and the type made
 * from it, so they can't drift apart. Not the Twilio id or the delivery
 * report, which it doesn't show.
 */
const TEXT_REPORT_FIELDS = [
  "id",
  "lead_id",
  "direction",
  "from_number",
  "to_number",
  "body",
  "created_at",
] as const satisfies readonly (keyof SmsMessage)[];

export type TextReportRow = Pick<SmsMessage, (typeof TEXT_REPORT_FIELDS)[number]>;

export const TEXT_REPORT_COLUMNS = TEXT_REPORT_FIELDS.join(", ");
