import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { getCompanyMembers } from "./company";
import { leadsLiteForMessages } from "./lead-lite";
import { selectAll } from "./select-all";
import type { SmsMessage } from "./types";
import {
  INBOX_CHANNELS,
  conversationKey,
  scanConversations,
  summarizeConversations,
  threadFromNewestFirst,
  type ConversationSummary,
  type InboxMessage,
  type ThreadKey,
} from "@/lib/reply-inbox";

/**
 * The Reply Inbox's reads (DECISIONS #141), as the signed-in person --
 * row level security narrows them exactly as before, including who sees
 * which texts (0192). Callers pass the company from the signed-in
 * profile, never from the browser.
 */

type Db = Awaited<ReturnType<typeof createClient>>;

/** What the list needs of a text: enough to key it, name it and show its snippet. */
const LIST_COLUMNS = "id, lead_id, direction, from_number, to_number, body, created_at";

/**
 * The newest `pages` pages of conversations, each named: by its contact,
 * a contact matched by number, a teammate, or the number itself.
 */
export async function loadInboxConversations(
  supabase: Db,
  companyId: string,
  pages: number
): Promise<{ conversations: ConversationSummary[]; hasMore: boolean }> {
  const { latest, hasMore } = await scanConversations<InboxMessage>(async (from, to) => {
    const { data, error } = await supabase
      .from("sms_messages")
      .select(LIST_COLUMNS)
      .eq("company_id", companyId)
      .or(INBOX_CHANNELS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as InboxMessage[];
  }, pages);

  // One text per conversation is enough to name it: its contact, or its number.
  const [leads, members] = await Promise.all([
    leadsLiteForMessages(supabase, companyId, latest),
    getCompanyMembers(companyId),
  ]);
  return {
    conversations: summarizeConversations(latest, leads, members.filter((r) => r.phone)),
    hasMore,
  };
}

/** One conversation's newest `limit` messages, oldest first, and whether older ones exist. */
export async function loadInboxThread(
  supabase: Db,
  companyId: string,
  key: ThreadKey,
  limit: number
): Promise<{ messages: SmsMessage[]; hasEarlier: boolean }> {
  if ("leadId" in key) {
    const { data, error } = await supabase
      .from("sms_messages")
      .select("*")
      .eq("company_id", companyId)
      .eq("lead_id", key.leadId)
      .or(INBOX_CHANNELS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);
    if (error) throw new Error(error.message);
    return threadFromNewestFirst((data ?? []) as SmsMessage[], limit);
  }

  // A conversation never linked to a contact: its texts by number (0204).
  const { data, error } = await supabase.rpc("reply_inbox_unlinked_thread", {
    p_company: companyId,
    p_phone_key: key.phoneKey,
    p_limit: limit + 1,
  });
  if (!error) return threadFromNewestFirst((data ?? []) as SmsMessage[], limit);

  // Until 0204 is run: every unlinked text, matched here. Unlinked texts
  // are the few the phone system couldn't tie to a contact.
  const wanted = `phone:${key.phoneKey}`;
  const unlinked = await selectAll<SmsMessage>((f, t) =>
    supabase
      .from("sms_messages")
      .select("*")
      .eq("company_id", companyId)
      .is("lead_id", null)
      .or(INBOX_CHANNELS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(f, t)
  );
  return threadFromNewestFirst(
    unlinked.filter((m) => conversationKey(m) === wanted),
    limit
  );
}
