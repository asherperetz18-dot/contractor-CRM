"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizePhone, type LeadLite, type SmsMessage } from "@/lib/data/types";
import { sendSms } from "@/lib/actions/sms";
import { getReplyInboxConversations, getReplyInboxThread } from "@/lib/actions/reply-inbox";
import { replyTargetSnapshot, type ReplyTargetSnapshot } from "@/lib/reply-target";
import {
  THREAD_MAX,
  THREAD_PAGE,
  mergeConversationLists,
  withPendingTarget,
  type ConversationSummary,
} from "@/lib/reply-inbox";
import { TEXTS_FRESH_EVENT } from "../popup-alerts";
import { DeliveryTag } from "@/components/ui/delivery-tag";

type Thread = { messages: SmsMessage[]; hasEarlier: boolean };

const readSignature = (limit: number, tick: number) => `${limit}:${tick}`;

/**
 * The newest conversations, and the messages of the one that's open
 * (DECISIONS #141). The page brings the first page of the list and the
 * conversation it opens on; any other conversation is read when it is
 * clicked, and "Show older conversations" reads the list further back.
 */
export function ReplyInboxView({
  conversations: firstPage,
  hasMore: firstPageHasMore,
  loadFailed,
  targetLeads,
  initialThread,
  canWrite,
}: {
  conversations: ConversationSummary[];
  hasMore: boolean;
  loadFailed: boolean;
  targetLeads: LeadLite[];
  initialThread: ({ key: string } & Thread) | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetLeadId = searchParams.get("leadId");
  const targetPhone = searchParams.get("phone");
  const targetBody = searchParams.get("body");

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [consumedTargetKey, setConsumedTargetKey] = useState<string | null>(null);
  // Kept in state rather than read from the URL each render: the effect
  // below strips the query string immediately, and deriving the
  // placeholder conversation from the params meant it vanished on the
  // very next render -- taking the selected thread with it. The whole
  // snapshot (name AND phone) is pinned, not just the ids: once the URL
  // is stripped, the next server render no longer carries the target
  // contact -- which used to leave this thread reading "New
  // conversation" with no number to send to.
  const [pendingTarget, setPendingTarget] = useState<ReplyTargetSnapshot | null>(null);
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  // "Show older conversations": the list read again from the top, one
  // page longer each time, so a refresh of the first page can't leave a
  // gap between the two.
  const [older, setOlder] = useState<{ pages: number; conversations: ConversationSummary[]; hasMore: boolean } | null>(
    null
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState("");

  // Opened conversations' messages, by conversation key: one opened
  // before shows at once while it is read again.
  const [threads, setThreads] = useState<Record<string, Thread>>(() =>
    initialThread ? { [initialThread.key]: { messages: initialThread.messages, hasEarlier: initialThread.hasEarlier } } : {}
  );
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [threadTick, setThreadTick] = useState(0);
  const [threadError, setThreadError] = useState("");
  const [earlierPending, setEarlierPending] = useState<string | null>(null);
  // What each conversation's messages were last read for (how many, and
  // which refresh), so a read is never repeated -- the page already read
  // the one it opens on.
  const loadedFor = useRef<Record<string, string>>(
    initialThread ? { [initialThread.key]: readSignature(THREAD_PAGE, 0) } : {}
  );

  const conversations = useMemo(
    () => withPendingTarget(mergeConversationLists(firstPage, older?.conversations ?? null), pendingTarget),
    [firstPage, older, pendingTarget]
  );
  const hasMore = older ? older.hasMore : firstPageHasMore;

  const targetKey = targetLeadId ?? (targetPhone ? `phone:${normalizePhone(targetPhone)}` : null);
  if (targetKey && targetKey !== consumedTargetKey) {
    setConsumedTargetKey(targetKey);
    setSelectedKey(targetKey);
    // Resolved NOW, while the ?leadId= render still carries the target
    // contact (the page fetches it for exactly this pass).
    setPendingTarget(replyTargetSnapshot(targetLeads, targetLeadId, targetPhone));
    if (targetBody) setReply(targetBody);
  } else if (selectedKey === null && conversations.length > 0) {
    // else-if, not a second statement. setSelectedKey does not change
    // selectedKey within this render, so running both meant the
    // auto-select fired on the same pass as an explicit target and
    // overwrote it -- landing on the newest thread instead of the one
    // asked for.
    setSelectedKey(conversations[0].key);
  }

  useEffect(() => {
    if (targetLeadId || targetPhone) {
      router.replace("/reply-inbox", { scroll: false });
    }
  }, [targetLeadId, targetPhone, router]);

  const limit = selectedKey ? limits[selectedKey] ?? THREAD_PAGE : THREAD_PAGE;

  // The open conversation's messages: read when it is opened, when more
  // are asked for, and when a text comes or goes (threadTick).
  useEffect(() => {
    if (!selectedKey) return;
    const signature = readSignature(limit, threadTick);
    if (loadedFor.current[selectedKey] === signature) return;
    let cancelled = false;
    getReplyInboxThread(selectedKey, limit).then((res) => {
      if (cancelled) return;
      setEarlierPending((k) => (k === selectedKey ? null : k));
      const thread = res.thread;
      if (res.error || !thread) {
        setThreadError(res.error ?? "Couldn't load these messages. Try again.");
        return;
      }
      loadedFor.current[selectedKey] = signature;
      setThreadError("");
      setThreads((t) => ({ ...t, [selectedKey]: thread }));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedKey, limit, threadTick]);

  // Live without its own poll: the popup watcher already asks the
  // server for fresh inbound texts every 20 seconds on every open tab
  // (a route handler, off the action path -- DECISIONS #029/#062).
  // When it sees one, this re-pulls the list and the open conversation,
  // so a customer's YES lands in the open thread instead of waiting for
  // a manual refresh. Selection and a half-typed reply live in state, so
  // the refresh does not disturb them.
  useEffect(() => {
    const onFresh = () => {
      router.refresh();
      setThreadTick((n) => n + 1);
    };
    window.addEventListener(TEXTS_FRESH_EVENT, onFresh);
    return () => window.removeEventListener(TEXTS_FRESH_EVENT, onFresh);
  }, [router]);

  // Deliberately no "?? conversations[0]" fallback here. That silently
  // pointed the composer at whichever thread was most recent whenever the
  // selected key stopped matching -- which is how a confirmation meant
  // for one contact was sent to a different one entirely.
  const selected = conversations.find((c) => c.key === selectedKey) ?? null;
  const thread = selectedKey ? threads[selectedKey] ?? null : null;
  const loadingEarlier = earlierPending !== null && earlierPending === selectedKey;

  function open(key: string) {
    setSelectedKey(key);
    setThreadError("");
  }

  async function showOlder() {
    const pages = (older?.pages ?? 1) + 1;
    setLoadingOlder(true);
    setOlderError("");
    const res = await getReplyInboxConversations(pages);
    setLoadingOlder(false);
    if (res.error || !res.conversations) {
      setOlderError(res.error ?? "Couldn't load older conversations. Try again.");
      return;
    }
    setOlder({ pages, conversations: res.conversations, hasMore: !!res.hasMore });
  }

  function showEarlier() {
    if (!selectedKey) return;
    setEarlierPending(selectedKey);
    setLimits((l) => ({ ...l, [selectedKey]: Math.min(limit + THREAD_PAGE, THREAD_MAX) }));
  }

  async function handleSend() {
    if (!selected) return;
    if (!reply.trim()) return;
    setPending(true);
    setError("");
    const result = await sendSms(selected.leadId, selected.phone, reply);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setReply("");
    router.refresh();
    setThreadTick((n) => n + 1);
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Reply Inbox</h1>
          <p className="module-sub">
            {hasMore
              ? `Your ${conversations.length} most recent conversations`
              : `${conversations.length} conversations`}
          </p>
        </div>
      </div>

      {loadFailed && (
        <p className="error-note">Couldn&apos;t load your conversations. Refresh the page to try again.</p>
      )}

      {conversations.length === 0 ? (
        !loadFailed && (
          <div className="empty-state">
            <p className="empty-label">No messages yet</p>
            <p className="empty-hint">
              Incoming texts to your Twilio number will show up here.
            </p>
          </div>
        )
      ) : (
        <div className="ri-layout">
          <div className="ri-list">
            {conversations.map((c) => {
              // A contact opened from elsewhere has no row of its own
              // until its messages arrive.
              const snippet = c.lastBody || threads[c.key]?.messages.at(-1)?.body;
              return (
                <div
                  key={c.key}
                  className={
                    "ri-list-item" + (selected?.key === c.key ? " ri-list-item-active" : "")
                  }
                  onClick={() => open(c.key)}
                >
                  <div className="ri-list-name">{c.name}</div>
                  <div className="ri-list-snippet">{snippet || "No messages yet"}</div>
                </div>
              );
            })}
            {hasMore && (
              <div className="ri-list-more">
                <button type="button" className="btn-ghost small" onClick={showOlder} disabled={loadingOlder}>
                  {loadingOlder ? "Loading…" : "Show older conversations"}
                </button>
                {olderError && <p className="error-note">{olderError}</p>}
              </div>
            )}
          </div>
          <div className="ri-thread">
            {selected ? (
              <>
                <div className="ri-thread-head">
                  <div className="ri-thread-name">{selected.name}</div>
                  <div className="ri-thread-phone">{selected.phone}</div>
                </div>
                {/* Said plainly, because the whole risk of showing crew
                    replies alongside customer ones is someone answering
                    this thread believing the homeowner will read it. */}
                {selected.isCrew && (
                  <p className="ri-crew-note">
                    Your crew, not the customer — we couldn&apos;t tell which appointment
                    this was about. Anything you send here goes to them.
                  </p>
                )}
                <div className="ri-thread-messages">
                  {!thread ? (
                    <p className="empty-hint">{threadError || "Loading messages…"}</p>
                  ) : thread.messages.length === 0 ? (
                    <p className="empty-hint">No messages yet — send the first one below.</p>
                  ) : (
                    <>
                      {thread.hasEarlier &&
                        (limit < THREAD_MAX ? (
                          <button
                            type="button"
                            className="btn-ghost small ri-earlier"
                            onClick={showEarlier}
                            disabled={loadingEarlier}
                          >
                            {loadingEarlier ? "Loading…" : "Show earlier messages"}
                          </button>
                        ) : (
                          <p className="empty-hint ri-earlier">Showing the newest {THREAD_MAX} texts.</p>
                        ))}
                      {thread.messages.map((m) => (
                        <div
                          key={m.id}
                          className={
                            "ri-bubble " + (m.direction === "outbound" ? "ri-bubble-out" : "ri-bubble-in")
                          }
                        >
                          <div>{m.body}</div>
                          <div className="ri-bubble-time">
                            {new Date(m.created_at).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                            <DeliveryTag
                              direction={m.direction}
                              status={m.delivery_status}
                              errorCode={m.delivery_error}
                            />
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                {thread && threadError && <p className="error-note">{threadError}</p>}
                {canWrite && (
                  <div className="ri-reply-bar">
                    <textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder={`Reply to ${selected.name}...`}
                      rows={2}
                    />
                    <button className="btn-primary" onClick={handleSend} disabled={pending}>
                      {pending ? "Sending…" : `Send to ${selected.name}`}
                    </button>
                  </div>
                )}
                {error && <p className="error-note">{error}</p>}
              </>
            ) : (
              <p className="empty-hint">Select a conversation.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
