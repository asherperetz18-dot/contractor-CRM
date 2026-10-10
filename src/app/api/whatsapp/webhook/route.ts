import { NextRequest, NextResponse, after } from "next/server";
import { sameSecret } from "@/lib/cron-token";
import { groupMessagesFromWebhook } from "@/lib/whatsapp-groups";
import { getWhatsAppForCompany, saveGroupMedia, storeGroupMessages } from "@/lib/whatsapp-company";
import { withRouteObservability } from "@/lib/observability/observe";

// The photo copies run after the answer, inside this budget.
export const maxDuration = 120;

/**
 * Where Whapi.Cloud posts every message the company's project-bot
 * number sees (DECISIONS #193). The URL carries ?c=<company uuid>&t=<the
 * secret made at Connect>; Whapi signs nothing, so that secret is the
 * whole check, compared in constant time.
 *
 * Group messages are filed at once and answered 200; a database failure
 * answers 500 so Whapi retries, and a retry files nothing twice. Their
 * photos are copied into the project after the answer -- Whapi counts a
 * slow answer as a failure.
 */
async function handlePost(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("c");
  const token = req.nextUrl.searchParams.get("t");
  if (!companyId || !token) return NextResponse.json({ error: "Missing ?c= or ?t=" }, { status: 400 });

  const conn = await getWhatsAppForCompany(companyId);
  if (!conn?.webhookToken || !sameSecret(token, conn.webhookToken)) {
    return NextResponse.json({ error: "Unknown hook." }, { status: 401 });
  }

  const messages = groupMessagesFromWebhook(await req.json().catch(() => null));
  const stored = await storeGroupMessages(companyId, messages);
  if (stored.error) return NextResponse.json({ error: "Not saved." }, { status: 500 });

  // Every group heard from, not only those with a new file: a copy that
  // failed earlier is retried on the group's next message.
  const groupIds = [...new Set(messages.map((m) => m.groupId))];
  if (groupIds.length) after(() => saveGroupMedia(companyId, groupIds, 90_000).then(() => undefined));
  return NextResponse.json({ ok: true, stored: messages.length });
}

export const POST = withRouteObservability("api.whatsapp.webhook", handlePost);
