/**
 * Monthly limits per company (DECISIONS #133): AI answers, texts and
 * emails. A platform admin sets them on the Companies page; until one is
 * set there is none. Checked where each thing is counted (#132) -- the AI
 * door, the text sender, the email sender -- before it happens.
 *
 * Pure, so the rules are tested apart from the database.
 */
import type { MonthUsage } from "./usage.ts";

export type LimitKind = "ai" | "sms" | "email";

/** Null means no limit. */
export type CompanyLimits = Record<LimitKind, number | null>;

export const NO_LIMITS: CompanyLimits = { ai: null, sms: null, email: null };

/** A company_limits row (0200), as the database spells it. */
export type LimitsRow = {
  company_id: string;
  ai_requests_per_month: number | null;
  sms_per_month: number | null;
  emails_per_month: number | null;
};

export function limitsFromRow(row: LimitsRow | null | undefined): CompanyLimits {
  if (!row) return NO_LIMITS;
  return { ai: row.ai_requests_per_month, sms: row.sms_per_month, email: row.emails_per_month };
}

const USED: Record<LimitKind, (u: MonthUsage) => number> = {
  ai: (u) => u.aiRequests,
  sms: (u) => u.smsSent,
  email: (u) => u.emailsSent,
};

export function limitReached(usage: MonthUsage, limits: CompanyLimits, kind: LimitKind): boolean {
  const limit = limits[kind];
  return limit !== null && USED[kind](usage) >= limit;
}

const NOUN: Record<LimitKind, [string, string]> = {
  ai: ["AI answer", "AI answers"],
  sms: ["text", "texts"],
  email: ["email", "emails"],
};

export function limitMessage(kind: LimitKind, limit: number): string {
  const [one, many] = NOUN[kind];
  return `Your company has used this month's ${limit.toLocaleString("en-US")} ${limit === 1 ? one : many}. It starts again on the 1st; ask AI Build Pros if you need more.`;
}

const MAX_LIMIT = 100_000_000;

/** What a platform admin typed: a whole number, or blank for no limit. */
export function parseLimitInput(raw: string): { value: number | null; error?: undefined } | { error: string; value?: undefined } {
  const text = raw.trim().replace(/,/g, "");
  if (!text) return { value: null };
  if (!/^\d+$/.test(text)) return { error: "Limits are whole numbers, or blank for no limit." };
  const value = Number(text);
  if (value > MAX_LIMIT) return { error: "That limit is too large." };
  return { value };
}

export function formatAgainstLimit(used: number, limit: number | null, one: string, many: string): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  if (limit === null) return `${fmt(used)} ${used === 1 ? one : many}`;
  return `${fmt(used)} of ${fmt(limit)} ${limit === 1 ? one : many}`;
}

/** This month's use, each against its limit when it has one. */
export function formatUsageWithLimits(u: MonthUsage, l: CompanyLimits): string {
  return [
    formatAgainstLimit(u.aiRequests, l.ai, "AI use", "AI uses"),
    formatAgainstLimit(u.smsSent, l.sms, "text", "texts"),
    formatAgainstLimit(u.emailsSent, l.email, "email", "emails"),
  ].join(" · ");
}
