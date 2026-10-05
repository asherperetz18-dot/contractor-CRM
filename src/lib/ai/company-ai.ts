import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { isCompanyLocked, LOCKED_SERVICES_ERROR } from "@/lib/billing/company-lock";

/**
 * The one door to the AI (DECISIONS #131). Every feature that asks the
 * model something -- the assistant, lead analysis, the scope writer and
 * estimator, call notes, the AI receptionist -- gets its client here, for
 * a named company, so a company whose subscription is locked gets none.
 * The AI is paid for by the platform, not the company, which is why this
 * is checked even on paths no locked company's people can reach.
 *
 * The usage tracking to come (Phase 4) counts here too, for the same
 * reason: one door, so nothing can go around it (company-ai.test.ts
 * holds every `new Anthropic(` to this file).
 */
export type CompanyAi =
  | { client: Anthropic }
  | { error: string; reason: "locked" | "not_configured" };

export async function aiForCompany(
  companyId: string,
  notConfigured = "AI isn't configured yet."
): Promise<CompanyAi> {
  if (await isCompanyLocked(companyId)) return { error: LOCKED_SERVICES_ERROR, reason: "locked" };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: notConfigured, reason: "not_configured" };
  return { client: new Anthropic({ apiKey }) };
}
