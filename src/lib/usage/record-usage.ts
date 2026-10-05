import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWarn } from "@/lib/observability/logger";
import type { UsageDeltas } from "@/lib/usage/usage";

/**
 * Adds to a company's counts for this month (DECISIONS #132), through
 * record_company_usage (0199) -- one statement, so uses at the same
 * moment all count. Never throws and never fails the thing being
 * counted: a text that went out must not report an error because its
 * tally didn't. Until 0199 has run there is nowhere to count, quietly.
 */
export async function recordUsage(companyId: string, deltas: UsageDeltas): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc("record_company_usage", {
      p_company_id: companyId,
      p_ai_requests: deltas.aiRequests ?? 0,
      p_ai_input_tokens: deltas.aiInputTokens ?? 0,
      p_ai_output_tokens: deltas.aiOutputTokens ?? 0,
      p_sms_sent: deltas.smsSent ?? 0,
      p_emails_sent: deltas.emailsSent ?? 0,
    });
    // PGRST202 / 42883: the function isn't there yet (0199 not run).
    if (error && error.code !== "PGRST202" && error.code !== "42883") {
      logWarn({ event: "usage.record_failed", companyId, message: error.message });
    }
  } catch (err) {
    logWarn({ event: "usage.record_failed", companyId, message: err instanceof Error ? err.message : String(err) });
  }
}
