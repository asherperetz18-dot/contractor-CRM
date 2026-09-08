import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTwilioForCompany } from "@/lib/twilio-company";

/**
 * Twilio Voice Intelligence: turns a call recording into a transcript.
 *
 * Chosen over an outside transcription vendor because the recordings
 * already live at Twilio under each company's own account -- the audio
 * never travels to a new service, the bill lands on the company that
 * made the call, and no new API key has to exist anywhere.
 */

const VI_BASE = "https://intelligence.twilio.com/v2";

type TwilioCreds = { accountSid: string; authToken: string };

async function viFetch(
  creds: TwilioCreds,
  path: string,
  init?: { method?: string; form?: Record<string, string> }
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> {
  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
  const res = await fetch(`${VI_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      ...(init?.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: init?.form ? new URLSearchParams(init.form).toString() : undefined,
    cache: "no-store",
  });
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

/**
 * The company's Voice Intelligence service, created on first use.
 *
 * The service carries the completion webhook, so transcripts announce
 * themselves instead of being polled for. Stored per company: two
 * companies on the shared platform account each get their own service,
 * which keeps their transcripts listable apart later.
 */
async function getOrCreateViService(
  companyId: string,
  creds: TwilioCreds,
  webhookUrl: string
): Promise<string | null> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("company_profile")
    .select("twilio_vi_service_sid")
    .eq("company_id", companyId)
    .maybeSingle<{ twilio_vi_service_sid: string | null }>();
  if (row?.twilio_vi_service_sid) return row.twilio_vi_service_sid;

  const unique = `crm-call-notes-${companyId.slice(0, 8)}`;
  const created = await viFetch(creds, "/Services", {
    method: "POST",
    form: {
      UniqueName: unique,
      WebhookUrl: webhookUrl,
      WebhookHttpMethod: "POST",
    },
  });
  let sid = created.ok ? String(created.json?.sid ?? "") : "";

  // A service by that unique name may already exist -- a previous
  // attempt that created it but died before the sid was saved. Claim
  // it rather than fail forever on the name collision.
  if (!sid) {
    const existing = await viFetch(creds, `/Services/${encodeURIComponent(unique)}`);
    if (existing.ok) sid = String(existing.json?.sid ?? "");
  }
  if (!sid) return null;

  await admin
    .from("company_profile")
    .update({ twilio_vi_service_sid: sid })
    .eq("company_id", companyId);
  return sid;
}

/**
 * Ask Voice Intelligence to transcribe one recording, and remember the
 * transcript sid on the call log so the completion webhook can find its
 * way back. Called from the recording-status webhook; every failure is
 * a silent no-op by design -- a missing AI note must never break the
 * recording pipeline that carries it.
 */
export async function requestCallTranscript(opts: {
  callLogId: string;
  companyId: string;
  recordingSid: string;
  webhookUrl: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("company_profile")
    .select("ai_call_notes_enabled")
    .eq("company_id", opts.companyId)
    .maybeSingle<{ ai_call_notes_enabled: boolean }>();
  if (!settings?.ai_call_notes_enabled) return;
  if (!process.env.ANTHROPIC_API_KEY) return;

  const twilio = await getTwilioForCompany(opts.companyId);
  if (!twilio) return;

  const serviceSid = await getOrCreateViService(opts.companyId, twilio, opts.webhookUrl);
  if (!serviceSid) return;

  const created = await viFetch(twilio, "/Transcripts", {
    method: "POST",
    form: {
      ServiceSid: serviceSid,
      Channel: JSON.stringify({ media_properties: { source_sid: opts.recordingSid } }),
    },
  });
  const transcriptSid = created.ok ? String(created.json?.sid ?? "") : "";
  if (!transcriptSid) return;

  await admin.from("call_logs").update({ transcript_sid: transcriptSid }).eq("id", opts.callLogId);
}

/**
 * The finished transcript as speaker-labelled lines.
 *
 * Recordings are dual-channel (record-from-answer-dual), so channel 1
 * is the rep's leg and channel 2 the customer's. The labels are stated
 * as probable rather than certain to the model downstream, which reads
 * the content anyway.
 */
export async function fetchTranscriptText(
  companyId: string,
  transcriptSid: string
): Promise<string | null> {
  const twilio = await getTwilioForCompany(companyId);
  if (!twilio) return null;

  const res = await viFetch(
    twilio,
    `/Transcripts/${encodeURIComponent(transcriptSid)}/Sentences?PageSize=500`
  );
  if (!res.ok) return null;
  const sentences = Array.isArray(res.json?.sentences)
    ? (res.json?.sentences as { media_channel?: number; transcript?: string }[])
    : [];

  const lines = sentences
    .map((s) => {
      const text = String(s.transcript ?? "").trim();
      if (!text) return null;
      return `${s.media_channel === 2 ? "Customer" : "Rep"}: ${text}`;
    })
    .filter((l): l is string => !!l);

  return lines.length ? lines.join("\n") : null;
}
