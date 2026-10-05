/**
 * What each company uses each month (DECISIONS #132): AI requests and
 * their size, texts sent and emails sent. Counted where each one
 * actually happens -- the one AI door, the Twilio sender, the email
 * sender -- into one row per company per month (company_usage, 0199).
 *
 * Pure, so the counting rules are tested apart from the database.
 */

export type MonthUsage = {
  aiRequests: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  smsSent: number;
  emailsSent: number;
};

export type UsageDeltas = Partial<MonthUsage>;

export function emptyUsage(): MonthUsage {
  return { aiRequests: 0, aiInputTokens: 0, aiOutputTokens: 0, smsSent: 0, emailsSent: 0 };
}

/** The month a use belongs to: its first day, YYYY-MM-01, in UTC. */
export function usageMonth(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

type AiUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/** One AI answer: one use, plus everything it read (cached or not) and wrote. */
export function aiUsageDeltas(usage: AiUsage | null | undefined): Required<Pick<UsageDeltas, "aiRequests" | "aiInputTokens" | "aiOutputTokens">> {
  const read =
    (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
  return { aiRequests: 1, aiInputTokens: read, aiOutputTokens: usage?.output_tokens ?? 0 };
}

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function formatUsageLine(u: MonthUsage): string {
  return [
    count(u.aiRequests, "AI use", "AI uses"),
    count(u.smsSent, "text", "texts"),
    count(u.emailsSent, "email", "emails"),
  ].join(" · ");
}

/** A company_usage row, as the database spells it. */
export type UsageRow = {
  company_id: string;
  month: string;
  ai_requests: number;
  ai_input_tokens: number;
  ai_output_tokens: number;
  sms_sent: number;
  emails_sent: number;
};

export function usageFromRow(row: UsageRow | null | undefined): MonthUsage {
  if (!row) return emptyUsage();
  return {
    aiRequests: Number(row.ai_requests ?? 0),
    aiInputTokens: Number(row.ai_input_tokens ?? 0),
    aiOutputTokens: Number(row.ai_output_tokens ?? 0),
    smsSent: Number(row.sms_sent ?? 0),
    emailsSent: Number(row.emails_sent ?? 0),
  };
}
