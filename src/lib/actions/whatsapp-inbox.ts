"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { selectAll } from "@/lib/data/select-all";
import { canEditChecklists, canManageBills, canManageCosts, isAdminRole } from "@/lib/data/types";
import { clientName, type ClientNameFields } from "@/lib/data/client-name";
import { privateFileUrl } from "@/lib/files/file-url";
import { receiptUploadPath } from "@/lib/receipts";
import { groupOptions, senderLabel, type GroupMessageKind, type MediaStatus } from "@/lib/whatsapp-groups";
import { suggestJob, type InboxJob } from "@/lib/whatsapp-inbox";
import { backfillGroup, getWhatsAppForCompany, listBotGroups, saveGroupMedia } from "@/lib/whatsapp-company";

/**
 * The WhatsApp Inbox (DECISIONS #204). A company's general WhatsApp
 * group -- receipts, supply runs, odd photos -- is on no job, so each
 * photo or file it posts waits here until someone files it to a job,
 * makes it a bill or dismisses it. The office and production sort it
 * (the people who file a job's paperwork); the group itself is added in
 * Settings by Office or Admin.
 */

const BUCKET = "lead-files";
const PAGE = 60;
const MIGRATION = "supabase/migrations/0230_whatsapp_inbox.sql";

type View = "to_sort" | "filed" | "dismissed";

async function requireSorter() {
  const profile = await getCurrentProfile();
  if (!profile || !canEditChecklists(profile)) return null;
  return profile;
}

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  return profile;
}

/** A job the signed-in person can see (RLS decides), with its customer. */
async function visibleJob(estimateId: string, companyId: string) {
  const { data } = await (await createClient())
    .from("estimates")
    .select("id, lead_id")
    .eq("id", estimateId)
    .eq("company_id", companyId)
    .maybeSingle<{ id: string; lead_id: string }>();
  return data;
}

/** A customer of this company. */
async function visibleLead(leadId: string, companyId: string) {
  const { data } = await createAdminClient()
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("company_id", companyId)
    .maybeSingle<{ id: string }>();
  return data;
}

type InboxRow = {
  id: string;
  group_id: string;
  media_status: string;
  media_path: string | null;
  media_name: string | null;
  media_type: string | null;
  media_size: number | null;
  inbox_status: string | null;
};

/** One of this company's inbox items: a photo or file from a general
 *  group, copied or not -- one whose copy failed can still be dismissed.
 *  Filing and billing check for the copy themselves. */
async function inboxMessage(companyId: string, messageId: string): Promise<InboxRow | null> {
  const admin = createAdminClient();
  const { data: msg } = await admin
    .from("whatsapp_group_messages")
    .select("id, group_id, media_status, media_path, media_name, media_type, media_size, inbox_status")
    .eq("id", messageId)
    .eq("company_id", companyId)
    .maybeSingle<InboxRow>();
  if (!msg || msg.media_status === "none") return null;
  const { data: link } = await admin
    .from("whatsapp_group_links")
    .select("group_id")
    .eq("company_id", companyId)
    .eq("group_id", msg.group_id)
    .eq("kind", "general")
    .maybeSingle();
  return link ? msg : null;
}

export type InboxItem = {
  id: string;
  sentAt: string;
  sender: string;
  groupName: string;
  kind: GroupMessageKind;
  body: string | null;
  mediaStatus: MediaStatus;
  mediaName: string | null;
  file: { url: string; name: string; contentType: string | null } | null;
  /** To sort: the job its caption points at. */
  suggestion: { estimateId: string; leadId: string; label: string; because: string } | null;
  /** Filed or dismissed: what happened to it. */
  outcome: string | null;
};

export type InboxJobOption = { estimateId: string; leadId: string; label: string; customer: string; address: string | null };

export type InboxData = {
  error?: string;
  migrationMissing?: boolean;
  groups: { id: string; name: string }[];
  counts: Record<View, number>;
  items: InboxItem[];
  hasMore: boolean;
  /** To sort: the general groups' latest text-only messages, to read. */
  texts: { id: string; sentAt: string; sender: string; who: "staff" | "client" | "other"; body: string }[];
  jobs: InboxJobOption[];
  canMakeBill: boolean;
  canBills: boolean;
};

const EMPTY: InboxData = {
  groups: [],
  counts: { to_sort: 0, filed: 0, dismissed: 0 },
  items: [],
  hasMore: false,
  texts: [],
  jobs: [],
  canMakeBill: false,
  canBills: false,
};

type JobRow = {
  id: string;
  lead_id: string;
  doc_number: string;
  title: string;
  kind: string | null;
  leads: (ClientNameFields & { address: string | null }) | null;
};

/** The jobs an inbox item can go to: signed contracts the person can see. */
async function inboxJobs(companyId: string): Promise<InboxJob[]> {
  const supabase = await createClient();
  const rows = await selectAll<JobRow>((from, to) =>
    supabase
      .from("estimates")
      .select("id, lead_id, doc_number, title, kind, leads(contact_type, company_name, first_name, last_name, address)")
      .eq("company_id", companyId)
      .eq("status", "Signed")
      .order("created_at", { ascending: false })
      .range(from, to)
  );
  return rows
    .filter((r) => (r.kind ?? "contract") === "contract")
    .map((r) => ({
      estimateId: r.id,
      leadId: r.lead_id,
      label: [clientName(r.leads) || r.doc_number, r.title].filter(Boolean).join(" — "),
      nameWords: [r.leads?.last_name ?? "", (r.leads?.company_name ?? "").split(/\s+/)[0] ?? ""].filter(Boolean),
      address: r.leads?.address ?? null,
      docNumber: r.doc_number,
    }));
}

export async function getWhatsAppInbox(view: View, before?: string): Promise<InboxData> {
  const profile = await requireSorter();
  if (!profile) return { ...EMPTY, error: "The WhatsApp Inbox is for Office, Admin and Production users." };
  const supabase = await createClient();

  const { data: links, error: linksError } = await supabase
    .from("whatsapp_group_links")
    .select("group_id, group_name")
    .eq("company_id", profile.company_id)
    .eq("kind", "general");
  if (linksError) return { ...EMPTY, migrationMissing: true };
  const groups = ((links ?? []) as { group_id: string; group_name: string }[]).map((l) => ({
    id: l.group_id,
    name: l.group_name || "Unnamed group",
  }));
  const base = { ...EMPTY, groups, canMakeBill: canManageCosts(profile), canBills: canManageBills(profile) };
  if (!groups.length) return base;
  const groupIds = groups.map((g) => g.id);
  const nameOf = new Map(groups.map((g) => [g.id, g.name]));

  const counted = (status: string | null) => {
    const q = supabase
      .from("whatsapp_group_messages")
      .select("id", { count: "exact", head: true })
      .eq("company_id", profile.company_id)
      .in("group_id", groupIds)
      .neq("media_status", "none");
    return status ? q.eq("inbox_status", status) : q.is("inbox_status", null);
  };

  let itemsQuery = supabase
    .from("whatsapp_group_messages")
    .select(
      "id, group_id, sender_phone, sender_name, from_me, kind, body, media_status, media_name, media_type, media_path, inbox_status, inbox_filed_as, inbox_estimate_id, sent_at"
    )
    .eq("company_id", profile.company_id)
    .in("group_id", groupIds)
    .neq("media_status", "none")
    .order("sent_at", { ascending: false })
    .limit(PAGE + 1);
  itemsQuery = view === "to_sort" ? itemsQuery.is("inbox_status", null) : itemsQuery.eq("inbox_status", view);
  if (before) itemsQuery = itemsQuery.lt("sent_at", before);

  const [toSort, filed, dismissed, { data: rows, error }, { data: textRows }, jobs, members] = await Promise.all([
    counted(null),
    counted("filed"),
    counted("dismissed"),
    itemsQuery,
    view === "to_sort" && !before
      ? supabase
          .from("whatsapp_group_messages")
          .select("id, sender_phone, sender_name, from_me, body, sent_at")
          .eq("company_id", profile.company_id)
          .in("group_id", groupIds)
          .eq("kind", "text")
          .order("sent_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    inboxJobs(profile.company_id),
    getCompanyMembers(profile.company_id),
  ]);
  if (error) return { ...base, error: error.message };

  const people = { staff: members.map((m) => ({ name: m.name, phone: m.phone })), client: null };
  const jobById = new Map(jobs.map((j) => [j.estimateId, j]));
  const page = ((rows ?? []) as {
    id: string;
    group_id: string;
    sender_phone: string | null;
    sender_name: string | null;
    from_me: boolean;
    kind: GroupMessageKind;
    body: string | null;
    media_status: MediaStatus;
    media_name: string | null;
    media_type: string | null;
    media_path: string | null;
    inbox_filed_as: string | null;
    inbox_estimate_id: string | null;
    sent_at: string;
  }[]).slice(0, PAGE);

  const items: InboxItem[] = page.map((r) => {
    const hint = view === "to_sort" ? suggestJob(r.body, jobs) : null;
    return {
      id: r.id,
      sentAt: r.sent_at,
      sender: senderLabel({ senderPhone: r.sender_phone, senderName: r.sender_name, fromMe: r.from_me }, people).label,
      groupName: nameOf.get(r.group_id) ?? "",
      kind: r.kind,
      body: r.body,
      mediaStatus: r.media_status,
      mediaName: r.media_name,
      file: r.media_path
        ? { url: privateFileUrl(BUCKET, r.media_path), name: r.media_name || "WhatsApp file", contentType: r.media_type }
        : null,
      suggestion: hint
        ? { estimateId: hint.job.estimateId, leadId: hint.job.leadId, label: hint.job.label, because: hint.because }
        : null,
      outcome:
        view === "dismissed"
          ? "Dismissed"
          : view === "filed"
            ? r.inbox_filed_as === "bill"
              ? "Made into a bill"
              : `Filed to ${jobById.get(r.inbox_estimate_id ?? "")?.label ?? "a job"}`
            : null,
    };
  });

  return {
    ...base,
    counts: { to_sort: toSort.count ?? 0, filed: filed.count ?? 0, dismissed: dismissed.count ?? 0 },
    items,
    hasMore: (rows ?? []).length > PAGE,
    texts: ((textRows ?? []) as {
      id: string;
      sender_phone: string | null;
      sender_name: string | null;
      from_me: boolean;
      body: string | null;
      sent_at: string;
    }[])
      .filter((t) => t.body)
      .map((t) => {
        const { label, who } = senderLabel(
          { senderPhone: t.sender_phone, senderName: t.sender_name, fromMe: t.from_me },
          people
        );
        return { id: t.id, sentAt: t.sent_at, sender: label, who, body: t.body as string };
      })
      .reverse(),
    jobs: jobs.map((j) => ({
      estimateId: j.estimateId,
      leadId: j.leadId,
      label: j.label,
      customer: j.label.split(" — ")[0],
      address: j.address,
    })),
  };
}

/**
 * Files an inbox photo or document into a job: a copy under the job's
 * customer, filed under the contract (what the job's Photos and Permits
 * & files read). It stays office-only, like everything from a general
 * group (#198). Claimed first, so two people sorting at once never file
 * one receipt twice.
 */
export async function fileInboxItem(messageId: string, estimateId: string): Promise<{ error?: string }> {
  const profile = await requireSorter();
  if (!profile) return { error: "Only Office, Admin or Production users can sort the inbox." };
  const msg = await inboxMessage(profile.company_id, messageId);
  if (!msg?.media_path) return { error: "That inbox item isn't available." };
  if (msg.inbox_status) return { error: "Someone already sorted this one." };
  const job = await visibleJob(estimateId, profile.company_id);
  if (!job) return { error: "That job isn't available." };

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: claimed } = await admin
    .from("whatsapp_group_messages")
    .update({ inbox_status: "filed", inbox_filed_as: "job_file", inbox_estimate_id: job.id, inbox_by: profile.id, inbox_at: now })
    .eq("id", msg.id)
    .eq("company_id", profile.company_id)
    .is("inbox_status", null)
    .select("id");
  if (!claimed?.length) return { error: "Someone already sorted this one." };
  const unclaim = () =>
    admin
      .from("whatsapp_group_messages")
      .update({ inbox_status: null, inbox_filed_as: null, inbox_estimate_id: null, inbox_by: null, inbox_at: null })
      .eq("id", msg.id);

  const fileName = msg.media_name || "WhatsApp file";
  const path = `${job.lead_id}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
  const { error: copyError } = await admin.storage.from(BUCKET).copy(msg.media_path, path);
  if (copyError) {
    await unclaim();
    return { error: "Couldn't copy the file into the job. Try again." };
  }
  const { data: file, error } = await admin
    .from("lead_files")
    .insert({
      lead_id: job.lead_id,
      uploaded_by: profile.id,
      file_name: fileName,
      file_path: path,
      file_url: privateFileUrl(BUCKET, path),
      file_size: msg.media_size,
      content_type: msg.media_type,
      storage_provider: "supabase",
      estimate_id: job.id,
      company_id: profile.company_id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !file) {
    await admin.storage.from(BUCKET).remove([path]);
    await unclaim();
    return { error: "Couldn't file it to the job. Try again." };
  }
  // The copy is now this message's file on the job, which is what keeps
  // it off the client's portal.
  await admin.from("whatsapp_group_messages").update({ lead_file_id: file.id }).eq("id", msg.id);
  revalidatePath("/whatsapp-inbox");
  return {};
}

export async function dismissInboxItem(messageId: string): Promise<{ error?: string }> {
  const profile = await requireSorter();
  if (!profile) return { error: "Only Office, Admin or Production users can sort the inbox." };
  const msg = await inboxMessage(profile.company_id, messageId);
  if (!msg) return { error: "That inbox item isn't available." };
  const { data } = await createAdminClient()
    .from("whatsapp_group_messages")
    .update({ inbox_status: "dismissed", inbox_by: profile.id, inbox_at: new Date().toISOString() })
    .eq("id", msg.id)
    .eq("company_id", profile.company_id)
    .is("inbox_status", null)
    .select("id");
  return data?.length ? {} : { error: "Someone already sorted this one." };
}

/** Back to "To sort", from Dismissed. */
export async function restoreInboxItem(messageId: string): Promise<{ error?: string }> {
  const profile = await requireSorter();
  if (!profile) return { error: "Only Office, Admin or Production users can sort the inbox." };
  const msg = await inboxMessage(profile.company_id, messageId);
  if (!msg) return { error: "That inbox item isn't available." };
  const { error } = await createAdminClient()
    .from("whatsapp_group_messages")
    .update({ inbox_status: null, inbox_by: null, inbox_at: null })
    .eq("id", msg.id)
    .eq("company_id", profile.company_id)
    .eq("inbox_status", "dismissed");
  return error ? { error: error.message } : {};
}

/**
 * The inbox file as a bill's receipt: copied into the receipt slot of
 * the job the bill is for (or the company's overhead slot), the same
 * place a receipt uploaded in the bill window lands -- so the bill saves
 * through the normal path and its checks.
 */
export async function inboxReceiptForBill(
  messageId: string,
  leadId: string | null
): Promise<{ error?: string; receipt?: { path: string; fileName: string; contentType: string | null } }> {
  const profile = await requireSorter();
  if (!profile || !canManageCosts(profile)) return { error: "You don't have access to record costs." };
  const msg = await inboxMessage(profile.company_id, messageId);
  if (!msg?.media_path) return { error: "That inbox item isn't available." };
  if (msg.inbox_status) return { error: "Someone already sorted this one." };
  if (leadId && !(await visibleLead(leadId, profile.company_id))) return { error: "Job not found." };

  const fileName = msg.media_name || "WhatsApp receipt";
  const path = receiptUploadPath(profile.company_id, leadId, fileName);
  const { error } = await createAdminClient().storage.from(BUCKET).copy(msg.media_path, path);
  if (error) return { error: "Couldn't attach the WhatsApp receipt. Try again." };
  return { receipt: { path, fileName, contentType: msg.media_type } };
}

/** After its bill saved: the inbox item is sorted. */
export async function markInboxItemBilled(messageId: string): Promise<{ error?: string }> {
  const profile = await requireSorter();
  if (!profile || !canManageCosts(profile)) return { error: "You don't have access to record costs." };
  const msg = await inboxMessage(profile.company_id, messageId);
  if (!msg) return { error: "That inbox item isn't available." };
  await createAdminClient()
    .from("whatsapp_group_messages")
    .update({ inbox_status: "filed", inbox_filed_as: "bill", inbox_by: profile.id, inbox_at: new Date().toISOString() })
    .eq("id", msg.id)
    .eq("company_id", profile.company_id)
    .is("inbox_status", null);
  revalidatePath("/whatsapp-inbox");
  return {};
}

export type GeneralGroups = {
  error?: string;
  migrationMissing?: boolean;
  groups: { id: string; name: string; toSort: number }[];
  /** The bot number's other groups, to add as general. */
  choices: { id: string; name: string; linkedTo: string | null }[];
};

/** Settings › WhatsApp Groups: the company's general groups. */
export async function listGeneralGroups(): Promise<GeneralGroups> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Office or Admin only.", groups: [], choices: [] };
  const admin = createAdminClient();
  const { data: links, error } = await admin
    .from("whatsapp_group_links")
    .select("*, estimates(doc_number, title, leads(contact_type, company_name, first_name, last_name))")
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message, groups: [], choices: [] };
  const all = (links ?? []) as unknown as {
    group_id: string;
    group_name: string;
    estimate_id: string | null;
    kind?: string;
    estimates: { doc_number: string; title: string; leads: ClientNameFields | null } | null;
  }[];
  if (all.length && all[0].kind === undefined) return { migrationMissing: true, groups: [], choices: [] };
  const general = all.filter((l) => l.kind === "general");

  const counts = await Promise.all(
    general.map((g) =>
      admin
        .from("whatsapp_group_messages")
        .select("id", { count: "exact", head: true })
        .eq("company_id", profile.company_id)
        .eq("group_id", g.group_id)
        .neq("media_status", "none")
        .is("inbox_status", null)
    )
  );

  const conn = await getWhatsAppForCompany(profile.company_id);
  const botGroups = conn ? ((await listBotGroups(conn.apiToken)) ?? []) : [];
  const generalIds = new Set(general.map((g) => g.group_id));
  const choices = groupOptions(
    botGroups.filter((g) => !generalIds.has(g.id)),
    all
      .filter((l) => l.kind !== "general")
      .map((l) => ({
        group_id: l.group_id,
        estimate_id: l.estimate_id ?? "",
        label:
          [clientName(l.estimates?.leads) || l.estimates?.doc_number, l.estimates?.title].filter(Boolean).join(" — ") ||
          "a job",
      })),
    ""
  );

  return {
    groups: general.map((g, i) => ({ id: g.group_id, name: g.group_name || "Unnamed group", toSort: counts[i].count ?? 0 })),
    choices,
  };
}

/**
 * Makes a group general: on no job, its posts go to the inbox. A group
 * that was on a job moves off it (its messages stay; files already on
 * the job stay there). Reads its last 100 messages and copies their
 * files in, after the answer.
 */
export async function addGeneralGroup(groupId: string): Promise<{ error?: string }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Office or Admin only." };
  const conn = await getWhatsAppForCompany(profile.company_id);
  if (!conn) return { error: "Connect the project bot number first." };
  const group = (await listBotGroups(conn.apiToken))?.find((g) => g.id === groupId);
  if (!group) return { error: "The project bot number isn't in that group." };

  const { error } = await createAdminClient()
    .from("whatsapp_group_links")
    .upsert(
      {
        company_id: profile.company_id,
        group_id: group.id,
        group_name: group.name,
        kind: "general",
        estimate_id: null,
        show_to_client: false,
        linked_by: profile.id,
        linked_at: new Date().toISOString(),
      },
      { onConflict: "company_id,group_id" }
    );
  if (error) return { error: /kind|estimate_id/.test(error.message) ? `Run ${MIGRATION} in the Supabase SQL editor first.` : error.message };

  const companyId = profile.company_id;
  after(async () => {
    await backfillGroup(companyId, conn.apiToken, group.id);
    await saveGroupMedia(companyId, [group.id], 45_000);
  });
  revalidatePath("/settings/whatsapp-groups");
  return {};
}

/** Stops treating a group as general. What it posted stays, sorted or not;
 *  nothing new arrives in the inbox from it. */
export async function removeGeneralGroup(groupId: string): Promise<{ error?: string }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Office or Admin only." };
  const { error } = await createAdminClient()
    .from("whatsapp_group_links")
    .delete()
    .eq("company_id", profile.company_id)
    .eq("group_id", groupId)
    .eq("kind", "general");
  if (error) return { error: error.message };
  revalidatePath("/settings/whatsapp-groups");
  return {};
}
