import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { isCompanyLocked, LOCKED_SERVICES_ERROR } from "@/lib/billing/company-lock";
import { recordUsage } from "@/lib/usage/record-usage";
import { aiUsageDeltas } from "@/lib/usage/usage";

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
  | { error: string; reason: "locked" | "not_configured" };

export async function aiForCompany(
  companyId: string,
  notConfigured = "AI isn't configured yet."
): Promise<CompanyAi> {
  if (await isCompanyLocked(companyId)) return { error: LOCKED_SERVICES_ERROR, reason: "locked" };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: notConfigured, reason: "not_configured" };
  return { client: metered(new Anthropic({ apiKey }), companyId) };
}

/**
 * The client, counting every answer it gets for this company (DECISIONS
 * #132): one AI use, plus the words read and written, once the answer is
 * complete. A request that fails isn't counted. Both ways the CRM asks --
 * a whole answer (create) and a streamed one (stream) -- are covered;
 * counting never changes what the caller gets back.
 */
function metered(client: Anthropic, companyId: string): Anthropic {
  const create = client.messages.create.bind(client.messages) as (
    ...args: unknown[]
  ) => Promise<{ usage?: Parameters<typeof aiUsageDeltas>[0] }>;
  const stream = client.messages.stream.bind(client.messages);

  client.messages.create = ((...args: unknown[]) =>
    create(...args).then(async (message) => {
      await recordUsage(companyId, aiUsageDeltas(message?.usage));
      return message;
    })) as unknown as typeof client.messages.create;

  client.messages.stream = ((...args: Parameters<typeof stream>) => {
    const live = stream(...args);
    live
      .finalMessage()
      .then((message) => recordUsage(companyId, aiUsageDeltas(message.usage)))
      .catch(() => {});
    return live;
  }) as typeof client.messages.stream;

  return client;
}
