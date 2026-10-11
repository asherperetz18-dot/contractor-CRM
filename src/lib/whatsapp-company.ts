import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto/secrets";
import { privateFileUrl } from "@/lib/files/file-url";
import { inboxPath } from "@/lib/whatsapp-inbox";
import {
  groupMessagesFromWebhook,
  initialMediaStatus,
  MAX_MEDIA_BYTES,
  mediaStatusAfterFailure,
  type GroupMessage,
} from "@/lib/whatsapp-groups";

/**
 * Project WhatsApp groups (DECISIONS #193): the database and Whapi side.
 * The rules -- what a message becomes, who it's from -- are in
 * src/lib/whatsapp-groups.ts.
 */

const WHAPI = "https://gate.whapi.cloud";
const BUCKET = "lead-files";

export type CompanyWhatsApp = { apiToken: string; webhookToken: string | null; phone: string | null };

/** A company's project-bot connection, decrypted, or null when there is
 *  none (or migration 0228 hasn't been run -- the select then errors and
 *  reads as "not connected"). */
export async function getWhatsAppForCompany(companyId: string): Promise<CompanyWhatsApp | null> {
  const { data } = await createAdminClient()
    .from("whatsapp_connections")
    .select("api_token_enc, webhook_token_enc, phone")
    .eq("company_id", companyId)
    .maybeSingle<{ api_token_enc: string | null; webhook_token_enc: string | null; phone: string | null }>();
  const apiToken = decryptSecret(data?.api_token_enc ?? null);
  if (!apiToken) return null;
  return { apiToken, webhookToken: decryptSecret(data?.webhook_token_enc ?? null), phone: data?.phone ?? null };
}

/** One call to Whapi. Never throws: a network failure or timeout comes
 *  back as null for the caller to word. */
export async function whapiFetch(
  apiToken: string,
  path: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number }
): Promise<Response | null> {
  return fetch(`${WHAPI}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init?.timeoutMs ?? 20_000),
  }).catch(() => null);
}

/** Every group the bot number is in, as Whapi lists them. */
export async function listBotGroups(apiToken: string): Promise<{ id: string; name: string }[] | null> {
  const groups: { id: string; name: string }[] = [];
  // Paged at Whapi's own default; 20 pages is far past any contractor.
  for (let page = 0; page < 20; page++) {
    const res = await whapiFetch(apiToken, `/groups?count=100&offset=${page * 100}`);
    if (!res?.ok) return page === 0 ? null : groups;
    const body = (await res.json().catch(() => null)) as { groups?: { id?: unknown; name?: unknown }[] } | null;
    const batch = Array.isArray(body?.groups) ? body.groups : [];
    for (const g of batch) {
      if (typeof g?.id === "string" && g.id.endsWith("@g.us")) {
        groups.push({ id: g.id, name: typeof g.name === "string" ? g.name : "" });
      }
    }
    if (batch.length < 100) break;
  }
  return groups;
}

/**
 * Files the messages, once each: a message Whapi posts twice (it retries
 * whatever it thinks failed) or that a backfill reads again is ignored.
 */
export async function storeGroupMessages(
  companyId: string,
  messages: GroupMessage[]
): Promise<{ error?: string }> {
  if (!messages.length) return {};
  const { error } = await createAdminClient()
    .from("whatsapp_group_messages")
    .upsert(
      messages.map((m) => ({
        company_id: companyId,
        group_id: m.groupId,
        wa_message_id: m.waMessageId,
        sender_phone: m.senderPhone,
        sender_name: m.senderName,
        from_me: m.fromMe,
        kind: m.kind,
        body: m.body,
        media_id: m.media?.id ?? null,
        media_type: m.media?.mimeType ?? null,
        media_name: m.media?.fileName ?? null,
        media_size: m.media?.size ?? null,
        media_status: initialMediaStatus(m.media),
        sent_at: m.sentAt,
      })),
      { onConflict: "company_id,wa_message_id", ignoreDuplicates: true }
    );
  return error ? { error: error.message } : {};
}

/** Reads a group's recent history -- what was said before it was linked,
 *  or while the webhook was down -- and files what's new. */
export async function backfillGroup(companyId: string, apiToken: string, groupId: string): Promise<void> {
  const res = await whapiFetch(apiToken, `/messages/list/${encodeURIComponent(groupId)}?count=100`);
  if (!res?.ok) return;
  const messages = groupMessagesFromWebhook(await res.json().catch(() => null));
  await storeGroupMessages(companyId, messages);
}

type PendingRow = {
  id: string;
  group_id: string;
  media_id: string;
  media_type: string | null;
  media_name: string | null;
  media_attempts: number;
};

// A copy that started this long ago died with its invocation.
const STALE_CLAIM_MS = 10 * 60 * 1000;

/**
 * Copies the waiting photos/videos/documents of the given groups into
 * the projects they're linked to: Whapi's bytes → the lead-files bucket
 * → a lead_files row filed under the job (estimate_id), which is what
 * the job's Photos and Permits & files read. A general group's go to the
 * company's inbox folder instead, to be sorted (#204). A group on no
 * project keeps its files waiting until it's linked.
 *
 * Runs after the webhook has answered, so it stops at `budgetMs` and
 * leaves the rest for the group's next message. Each row is claimed
 * before it's copied, so two overlapping runs never file one photo twice.
 */
export async function saveGroupMedia(
  companyId: string,
  groupIds: string[],
  budgetMs = 60_000
): Promise<{ saved: number }> {
  const started = Date.now();
  let saved = 0;
  if (!groupIds.length) return { saved };
  const admin = createAdminClient();

  // "*": before 0230 there is no kind, and every link is a job's.
  const { data: links } = await admin
    .from("whatsapp_group_links")
    .select("*, estimates(lead_id)")
    .eq("company_id", companyId)
    .in("group_id", groupIds);
  const jobOf = new Map<string, { estimateId: string; leadId: string }>();
  const general = new Set<string>();
  for (const l of (links ?? []) as unknown as {
    group_id: string;
    estimate_id: string | null;
    kind?: string;
    estimates: { lead_id: string | null } | null;
  }[]) {
    if (l.kind === "general") general.add(l.group_id);
    else if (l.estimate_id && l.estimates?.lead_id) {
      jobOf.set(l.group_id, { estimateId: l.estimate_id, leadId: l.estimates.lead_id });
    }
  }
  if (!jobOf.size && !general.size) return { saved };

  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data: rows } = await admin
    .from("whatsapp_group_messages")
    .select("id, group_id, media_id, media_type, media_name, media_attempts")
    .eq("company_id", companyId)
    .in("group_id", [...jobOf.keys(), ...general])
    .or(`media_status.eq.pending,and(media_status.eq.saving,media_claimed_at.lt."${staleBefore}")`)
    .order("sent_at", { ascending: true })
    .limit(25);
  if (!rows?.length) return { saved };

  const conn = await getWhatsAppForCompany(companyId);
  if (!conn) return { saved };

  for (const row of rows as PendingRow[]) {
    if (Date.now() - started > budgetMs) break;
    const job = jobOf.get(row.group_id);
    if (!job && !general.has(row.group_id)) continue;

    // The claim: only the run whose update matches the attempt count it
    // read gets to copy this row.
    const attempt = row.media_attempts + 1;
    const { data: claimed } = await admin
      .from("whatsapp_group_messages")
      .update({ media_status: "saving", media_claimed_at: new Date().toISOString(), media_attempts: attempt })
      .eq("id", row.id)
      .eq("media_attempts", row.media_attempts)
      .select("id");
    if (!claimed?.length) continue;

    const result = job
      ? await copyOne(conn.apiToken, companyId, job, row)
      : await copyToInbox(conn.apiToken, companyId, row);
    await admin
      .from("whatsapp_group_messages")
      .update(
        result === "too_large"
          ? { media_status: "too_large" }
          : typeof result === "string"
            ? { media_status: mediaStatusAfterFailure(attempt) }
            : "leadFileId" in result
              ? { media_status: "saved", lead_file_id: result.leadFileId }
              : { media_status: "saved", media_path: result.mediaPath }
      )
      .eq("id", row.id);
    if (typeof result !== "string") saved++;
  }
  return { saved };
}

/** The file's bytes from Whapi, or why not. */
async function fetchMedia(
  apiToken: string,
  row: PendingRow
): Promise<{ bytes: ArrayBuffer; contentType: string; fileName: string } | "too_large" | "failed"> {
  const res = await whapiFetch(apiToken, `/media/${encodeURIComponent(row.media_id)}`, { timeoutMs: 45_000 });
  if (!res?.ok) return "failed";
  if (Number(res.headers.get("content-length") ?? 0) > MAX_MEDIA_BYTES) return "too_large";
  const bytes = await res.arrayBuffer().catch(() => null);
  if (!bytes) return "failed";
  if (bytes.byteLength > MAX_MEDIA_BYTES) return "too_large";
  return {
    bytes,
    contentType: row.media_type || res.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream",
    fileName: row.media_name || `whatsapp-${row.id}`,
  };
}

/** A general group's file, into the company's inbox folder. Named by
 *  its message, so a retry overwrites its own half-copy and nothing else. */
async function copyToInbox(
  apiToken: string,
  companyId: string,
  row: PendingRow
): Promise<{ mediaPath: string } | "too_large" | "failed"> {
  const media = await fetchMedia(apiToken, row);
  if (typeof media === "string") return media;
  const path = inboxPath(companyId, row.id, media.fileName);
  const { error } = await createAdminClient()
    .storage.from(BUCKET)
    .upload(path, media.bytes, { contentType: media.contentType, upsert: true });
  return error ? "failed" : { mediaPath: path };
}

async function copyOne(
  apiToken: string,
  companyId: string,
  job: { estimateId: string; leadId: string },
  row: PendingRow
): Promise<{ leadFileId: string } | "too_large" | "failed"> {
  const media = await fetchMedia(apiToken, row);
  if (typeof media === "string") return media;
  const { bytes, contentType, fileName } = media;
  const path = `${job.leadId}/${Date.now()}-${fileName}`;
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType });
  if (uploadError) return "failed";

  const { data: file, error } = await admin
    .from("lead_files")
    .insert({
      lead_id: job.leadId,
      uploaded_by: null,
      file_name: fileName,
      file_path: path,
      file_url: privateFileUrl(BUCKET, path),
      file_size: bytes.byteLength,
      content_type: contentType,
      storage_provider: "supabase",
      estimate_id: job.estimateId,
      company_id: companyId,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !file) {
    // Nothing points at the object now -- don't leave it orphaned.
    await admin.storage.from(BUCKET).remove([path]);
    return "failed";
  }
  return { leadFileId: file.id };
}
