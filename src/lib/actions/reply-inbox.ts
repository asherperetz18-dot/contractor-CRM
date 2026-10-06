"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { loadInboxConversations, loadInboxThread } from "@/lib/data/reply-inbox";
import type { SmsMessage } from "@/lib/data/types";
import {
  conversationPages,
  parseConversationKey,
  threadLimit,
  type ConversationSummary,
} from "@/lib/reply-inbox";

/**
 * The Reply Inbox's reads after the first render (DECISIONS #141): one
 * conversation when it is opened, and the longer list behind "Show older
 * conversations". Read as the signed-in person, in their own company --
 * the browser sends only which conversation and how much, both checked
 * before any query.
 */

export async function getReplyInboxThread(
  key: string,
  limit: number
): Promise<{ error?: string; thread?: { messages: SmsMessage[]; hasEarlier: boolean } }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  const parsed = parseConversationKey(key);
  if (!parsed) return { error: "That conversation can't be found." };

  const supabase = await createClient();
  try {
    return { thread: await loadInboxThread(supabase, profile.company_id, parsed, threadLimit(limit)) };
  } catch {
    return { error: "Couldn't load these messages. Try again." };
  }
}

export async function getReplyInboxConversations(
  pages: number
): Promise<{ error?: string; conversations?: ConversationSummary[]; hasMore?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  try {
    return await loadInboxConversations(supabase, profile.company_id, conversationPages(pages));
  } catch {
    return { error: "Couldn't load older conversations. Try again." };
  }
}
