import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { leadsLiteByIds } from "@/lib/data/lead-lite";
import { loadInboxConversations, loadInboxThread } from "@/lib/data/reply-inbox";
import { canEditDispatch } from "@/lib/data/types";
import {
  THREAD_PAGE,
  initialConversationKey,
  parseConversationKey,
  type ConversationSummary,
} from "@/lib/reply-inbox";
import { ReplyInboxView } from "./reply-inbox-view";

export default async function ReplyInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string; phone?: string }>;
}) {
  const { leadId: targetLeadId, phone: targetPhone } = await searchParams;
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const canWrite = canEditDispatch(profile);
  const companyId = profile?.company_id ?? "";

  // The newest conversations only -- this page used to read every text
  // the company ever sent or got, here and again on every new one
  // (DECISIONS #141). Plus the contact a compose deep-link (?leadId=)
  // targets, which may have no texts, or none recent.
  const empty: { conversations: ConversationSummary[]; hasMore: boolean } = { conversations: [], hasMore: false };
  const [listResult, targetLeads] = await Promise.all([
    profile ? loadInboxConversations(supabase, companyId, 1).catch(() => null) : empty,
    targetLeadId ? leadsLiteByIds(supabase, companyId, [targetLeadId]) : Promise.resolve([]),
  ]);
  const list = listResult ?? empty;

  // The conversation the view opens on comes with the page, so it doesn't
  // open empty and then fill in.
  const openKey = initialConversationKey(targetLeadId, targetPhone, list.conversations);
  const parsed = profile && openKey ? parseConversationKey(openKey) : null;
  const thread = parsed
    ? await loadInboxThread(supabase, companyId, parsed, THREAD_PAGE).catch(() => null)
    : null;

  return (
    <ReplyInboxView
      conversations={list.conversations}
      hasMore={list.hasMore}
      loadFailed={!listResult}
      targetLeads={targetLeads}
      initialThread={openKey && thread ? { key: openKey, ...thread } : null}
      canWrite={canWrite}
    />
  );
}
