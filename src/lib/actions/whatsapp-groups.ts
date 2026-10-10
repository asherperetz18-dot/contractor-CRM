"use server";

import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { canEditChecklists, isAdminRole, leadPhotoThumbUrl } from "@/lib/data/types";
import { clientName, type ClientNameFields } from "@/lib/data/client-name";
import { decryptSecret, encryptionAvailable, encryptSecret } from "@/lib/crypto/secrets";
import { driveFileId } from "@/lib/files/preview";
import {
  groupOptions,
  senderLabel,
  webhookUrl,
  withOurWebhook,
  withoutOurWebhook,
  type GroupMessageKind,
  type MediaStatus,
} from "@/lib/whatsapp-groups";
import {
  backfillGroup,
  getWhatsAppForCompany,
  listBotGroups,
  saveGroupMedia,
  whapiFetch,
} from "@/lib/whatsapp-company";

/**
 * Project WhatsApp groups (DECISIONS #193): connecting the company's
 * project-bot number (Settings › WhatsApp Groups, Office/Admin), and a
 * job's own groups -- linking one, and reading what was said in it.
 */

const APP_ORIGIN = "https://crm.aibuildpros.com";
const MIGRATION = "supabase/migrations/0228_whatsapp_groups.sql";
const PAGE = 60;

export type WhatsAppStatus = {
  connected: boolean;
  phone: string | null;
  connectedAt: string | null;
  encryptionReady: boolean;
  /** Migration 0228 hasn't been pasted yet -- named on the page. */
  migrationMissing: boolean;
};

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  return profile;
}

export async function getWhatsAppStatus(): Promise<WhatsAppStatus | null> {
  const profile = await requireAdmin();
  if (!profile) return null;
  const { data, error } = await createAdminClient()
    .from("whatsapp_connections")
    .select("api_token_enc, phone, connected_at")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ api_token_enc: string | null; phone: string | null; connected_at: string | null }>();
  return {
    connected: !!data?.api_token_enc,
    phone: data?.phone ?? null,
    connectedAt: data?.connected_at ?? null,
    encryptionReady: encryptionAvailable(),
    migrationMissing: !!error,
  };
}

/**
 * Connects the company's project-bot number: checks the Whapi token,
 * points the channel's webhook at us (keeping any other hook the
 * channel feeds), and stores the token encrypted.
 */
export async function connectWhatsApp(input: { apiToken: string }): Promise<{ error?: string; phone?: string | null }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Office or Admin only." };
  if (!encryptionAvailable()) {
    return { error: "APP_ENCRYPTION_KEY is not configured, so keys can't be stored safely." };
  }
  const apiToken = input.apiToken.trim();
  if (!apiToken) return { error: "Paste the channel's API token from Whapi." };

  const health = await whapiFetch(apiToken, "/health?wakeup=true");
  if (!health) return { error: "Couldn't reach Whapi. Try again in a minute." };
  if (health.status === 401 || health.status === 403) return { error: "Whapi didn't accept that token." };
  if (!health.ok) return { error: `Whapi answered ${health.status}.` };
  const healthBody = (await health.json().catch(() => null)) as {
    status?: { text?: string };
    user?: { id?: string; name?: string };
  } | null;
  if (!healthBody?.user?.id) {
    return {
      error:
        "That channel has no WhatsApp number signed in yet. In Whapi, scan the QR code with the project bot phone, then connect again.",
    };
  }
  const phone = healthBody.user.id.split("@")[0];

  // Keep the webhook secret across reconnects, so the hook Whapi
  // already has keeps pointing at a URL that works.
  const admin = createAdminClient();
  const { data: row, error: readError } = await admin
    .from("whatsapp_connections")
    .select("webhook_token_enc")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ webhook_token_enc: string | null }>();
  if (readError) return { error: `Run ${MIGRATION} in the Supabase SQL editor first.` };
  const token = decryptSecret(row?.webhook_token_enc ?? null) || randomBytes(24).toString("hex");

  // Whapi's PATCH replaces the whole list: read it, swap ours in.
  const current = await whapiFetch(apiToken, "/settings");
  const settings = current?.ok ? ((await current.json().catch(() => null)) as { webhooks?: unknown } | null) : null;
  if (!settings) return { error: "Couldn't read the channel's settings from Whapi." };
  const set = await whapiFetch(apiToken, "/settings", {
    method: "PATCH",
    body: { webhooks: withOurWebhook(settings.webhooks, webhookUrl(APP_ORIGIN, profile.company_id, token)) },
  });
  if (!set?.ok) return { error: "Whapi wouldn't save the CRM's webhook on that channel." };

  const now = new Date().toISOString();
  const { error } = await admin.from("whatsapp_connections").upsert({
    company_id: profile.company_id,
    api_token_enc: encryptSecret(apiToken),
    webhook_token_enc: encryptSecret(token),
    phone,
    connected_by: profile.id,
    connected_at: now,
    updated_at: now,
  });
  if (error) return { error: error.message };

  revalidatePath("/settings/whatsapp-groups");
  return { phone };
}

export async function disconnectWhatsApp(): Promise<{ error?: string }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Office or Admin only." };

  // Best effort: a hook left behind only posts to a URL that now
  // answers 401.
  const conn = await getWhatsAppForCompany(profile.company_id);
  if (conn) {
    const current = await whapiFetch(conn.apiToken, "/settings");
    const settings = current?.ok ? ((await current.json().catch(() => null)) as { webhooks?: unknown } | null) : null;
    if (settings) {
      await whapiFetch(conn.apiToken, "/settings", {
        method: "PATCH",
        body: { webhooks: withoutOurWebhook(settings.webhooks, profile.company_id) },
      });
    }
  }

  const { error } = await createAdminClient()
    .from("whatsapp_connections")
    .delete()
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };
  revalidatePath("/settings/whatsapp-groups");
  return {};
}

export type JobWhatsAppMessage = {
  id: string;
  sentAt: string;
  sender: string;
  who: "staff" | "client" | "other";
  kind: GroupMessageKind;
  body: string | null;
  media: null | {
    status: MediaStatus;
    name: string | null;
    file: null | { url: string; thumbUrl: string; name: string; contentType: string | null; driveId: string | null };
  };
};

export type JobWhatsApp = {
  error?: string;
  migrationMissing?: boolean;
  /** The company has a project-bot number connected. */
  connected: boolean;
  /** May link and unlink groups: the people who run the paperwork. */
  canLink: boolean;
  groups: { id: string; name: string }[];
  /** Oldest first, the way a chat reads. */
  messages: JobWhatsAppMessage[];
  hasMore: boolean;
};

const EMPTY: JobWhatsApp = { connected: false, canLink: false, groups: [], messages: [], hasMore: false };

type LeadRow = ClientNameFields & {
  phone: string | null;
  phone2: string | null;
  phone3: string | null;
  second_contact_phone: string | null;
};

/**
 * One job's WhatsApp groups and the newest of what was said in them
 * (`before` pages back). Read as the signed-in person: if RLS hides the
 * job, its groups and messages are hidden with it.
 */
export async function getJobWhatsApp(estimateId: string, before?: string): Promise<JobWhatsApp> {
  const profile = await getCurrentProfile();
  if (!profile) return { ...EMPTY, error: "Not signed in." };
  const supabase = await createClient();

  const { data: est } = await supabase
    .from("estimates")
    .select("id, lead_id")
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; lead_id: string }>();
  if (!est) return { ...EMPTY, error: "That job isn't available." };

  const [{ data: conn }, { data: links, error: linksError }] = await Promise.all([
    createAdminClient()
      .from("whatsapp_connections")
      .select("company_id")
      .eq("company_id", profile.company_id)
      .not("api_token_enc", "is", null)
      .maybeSingle(),
    supabase
      .from("whatsapp_group_links")
      .select("group_id, group_name")
      .eq("company_id", profile.company_id)
      .eq("estimate_id", estimateId)
      .order("linked_at", { ascending: true }),
  ]);
  if (linksError) return { ...EMPTY, migrationMissing: true };

  const groups = (links ?? []).map((l) => ({ id: l.group_id as string, name: (l.group_name as string) || "Unnamed group" }));
  const base = { connected: !!conn, canLink: canEditChecklists(profile), groups };
  if (!groups.length) return { ...base, messages: [], hasMore: false };

  let query = supabase
    .from("whatsapp_group_messages")
    .select("id, group_id, sender_phone, sender_name, from_me, kind, body, media_status, media_name, lead_file_id, sent_at")
    .eq("company_id", profile.company_id)
    .in(
      "group_id",
      groups.map((g) => g.id)
    )
    .order("sent_at", { ascending: false })
    .limit(PAGE + 1);
  if (before) query = query.lt("sent_at", before);
  const { data: rows, error } = await query;
  if (error) return { ...base, messages: [], hasMore: false, error: error.message };

  const page = (rows ?? []).slice(0, PAGE) as {
    id: string;
    sender_phone: string | null;
    sender_name: string | null;
    from_me: boolean;
    kind: GroupMessageKind;
    body: string | null;
    media_status: MediaStatus;
    media_name: string | null;
    lead_file_id: string | null;
    sent_at: string;
  }[];

  const fileIds = page.map((r) => r.lead_file_id).filter((id): id is string => !!id);
  const [{ data: files }, { data: lead }, members] = await Promise.all([
    fileIds.length
      ? supabase
          .from("lead_files")
          .select("id, file_name, file_url, content_type, file_path, storage_provider")
          .in("id", fileIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from("leads")
      .select("contact_type, company_name, first_name, last_name, phone, phone2, phone3, second_contact_phone")
      .eq("id", est.lead_id)
      .maybeSingle<LeadRow>(),
    getCompanyMembers(profile.company_id),
  ]);

  const fileById = new Map(
    ((files ?? []) as {
      id: string;
      file_name: string;
      file_url: string;
      content_type: string | null;
      file_path: string | null;
      storage_provider: string | null;
    }[]).map((f) => [f.id, f])
  );
  const people = {
    staff: members.map((m) => ({ name: m.name, phone: m.phone })),
    client: lead
      ? {
          name: clientName(lead) || "Client",
          phones: [lead.phone, lead.phone2, lead.phone3, lead.second_contact_phone],
        }
      : null,
  };

  const messages = page
    .map((r): JobWhatsAppMessage => {
      const { label, who } = senderLabel(
        { senderPhone: r.sender_phone, senderName: r.sender_name, fromMe: r.from_me },
        people
      );
      const f = r.lead_file_id ? fileById.get(r.lead_file_id) : undefined;
      return {
        id: r.id,
        sentAt: r.sent_at,
        sender: label,
        who,
        kind: r.kind,
        body: r.body,
        media:
          r.media_status === "none"
            ? null
            : {
                status: r.media_status,
                name: r.media_name,
                file: f
                  ? {
                      url: f.file_url,
                      thumbUrl: leadPhotoThumbUrl(f),
                      name: f.file_name,
                      contentType: f.content_type,
                      driveId: driveFileId(f),
                    }
                  : null,
              },
      };
    })
    .reverse();

  return { ...base, messages, hasMore: (rows ?? []).length > PAGE };
}

/** Who may link: the same people who file a job's documents. */
async function requireLinker() {
  const profile = await getCurrentProfile();
  if (!profile || !canEditChecklists(profile)) return null;
  return profile;
}

/** The job, if the signed-in person can see it (RLS decides). */
async function visibleJob(estimateId: string, companyId: string) {
  const { data } = await (await createClient())
    .from("estimates")
    .select("id")
    .eq("id", estimateId)
    .eq("company_id", companyId)
    .maybeSingle<{ id: string }>();
  return data;
}

/** The bot number's groups this job could link. */
export async function listWhatsAppGroupChoices(
  estimateId: string
): Promise<{ error?: string; options?: { id: string; name: string; linkedTo: string | null }[] }> {
  const profile = await requireLinker();
  if (!profile) return { error: "Only Office, Admin or Production users can link groups." };
  if (!(await visibleJob(estimateId, profile.company_id))) return { error: "That job isn't available." };
  const conn = await getWhatsAppForCompany(profile.company_id);
  if (!conn) return { error: "Connect the project bot number in Settings › WhatsApp Groups first." };

  const groups = await listBotGroups(conn.apiToken);
  if (!groups) return { error: "Couldn't load the bot number's groups from Whapi." };

  const { data: links } = await createAdminClient()
    .from("whatsapp_group_links")
    .select("group_id, estimate_id, estimates(doc_number, title, leads(contact_type, company_name, first_name, last_name))")
    .eq("company_id", profile.company_id);
  const labelled = ((links ?? []) as unknown as {
    group_id: string;
    estimate_id: string;
    estimates: { doc_number: string; title: string; leads: ClientNameFields | null } | null;
  }[]).map((l) => ({
    group_id: l.group_id,
    estimate_id: l.estimate_id,
    label:
      [clientName(l.estimates?.leads) || l.estimates?.doc_number, l.estimates?.title].filter(Boolean).join(" — ") ||
      "another job",
  }));
  return { options: groupOptions(groups, labelled, estimateId) };
}

/**
 * Puts a group on this job -- moving it, if it was on another -- then
 * reads the group's recent history and copies its files in, after the
 * answer.
 */
export async function linkWhatsAppGroup(estimateId: string, groupId: string): Promise<{ error?: string }> {
  const profile = await requireLinker();
  if (!profile) return { error: "Only Office, Admin or Production users can link groups." };
  if (!(await visibleJob(estimateId, profile.company_id))) return { error: "That job isn't available." };
  const conn = await getWhatsAppForCompany(profile.company_id);
  if (!conn) return { error: "Connect the project bot number in Settings › WhatsApp Groups first." };

  // Only a group the bot number is actually in: the name comes from
  // there too.
  const group = (await listBotGroups(conn.apiToken))?.find((g) => g.id === groupId);
  if (!group) return { error: "The project bot number isn't in that group." };

  const { error } = await createAdminClient()
    .from("whatsapp_group_links")
    .upsert(
      {
        company_id: profile.company_id,
        group_id: group.id,
        group_name: group.name,
        estimate_id: estimateId,
        linked_by: profile.id,
        linked_at: new Date().toISOString(),
      },
      { onConflict: "company_id,group_id" }
    );
  if (error) return { error: error.message };

  const companyId = profile.company_id;
  after(async () => {
    await backfillGroup(companyId, conn.apiToken, group.id);
    await saveGroupMedia(companyId, [group.id], 45_000);
  });
  return {};
}

/** Takes a group off this job. Its messages stay, and come back if it's
 *  linked again; photos already copied stay in the job's files. */
export async function unlinkWhatsAppGroup(estimateId: string, groupId: string): Promise<{ error?: string }> {
  const profile = await requireLinker();
  if (!profile) return { error: "Only Office, Admin or Production users can unlink groups." };
  if (!(await visibleJob(estimateId, profile.company_id))) return { error: "That job isn't available." };
  const { error } = await createAdminClient()
    .from("whatsapp_group_links")
    .delete()
    .eq("company_id", profile.company_id)
    .eq("estimate_id", estimateId)
    .eq("group_id", groupId);
  return error ? { error: error.message } : {};
}
