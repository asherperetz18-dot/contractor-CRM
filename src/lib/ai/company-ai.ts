import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { isCompanyLocked, LOCKED_SERVICES_ERROR, lockedServicesError } from "@/lib/billing/company-lock";
import { recordUsage } from "@/lib/usage/record-usage";
import { usageLimitError } from "@/lib/usage/company-limits";
import { aiUsageDeltas } from "@/lib/usage/usage";
import { metered } from "@/lib/ai/metered";

/**
 * The one door to the AI (DECISIONS #131). Every feature that asks the
 * model something -- the assistant, lead analysis, the scope writer and
 * estimator, call notes, the AI receptionist -- gets its client here, for
 * a named company, so a company whose subscription is locked gets none.
 * The AI is paid for by the platform, not the company, which is why this
 * is checked even on paths no locked company's people can reach.
 *
 * Every answer is counted here too (DECISIONS #132), for the same reason:
 * one door, so nothing can go around it (company-lock.test.ts holds
 * every `new Anthropic(` to this file).
 */
export type CompanyAi =
  | { client: Anthropic }
  | { error: string; reason: "locked" | "limit" | "not_configured" };

export async function aiForCompany(
  companyId: string,
  notConfigured = "AI isn't configured yet."
): Promise<CompanyAi> {
  if (await isCompanyLocked(companyId)) {
    return { error: (await lockedServicesError(companyId)) ?? LOCKED_SERVICES_ERROR, reason: "locked" };
  }
  // This month's AI answers used up (DECISIONS #133).
  const limited = await usageLimitError(companyId, "ai");
  if (limited) return { error: limited, reason: "limit" };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: notConfigured, reason: "not_configured" };
  return { client: metered(new Anthropic({ apiKey }), (usage) => recordUsage(companyId, aiUsageDeltas(usage))) };
}
