"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  leadDisplayName,
  normalizePhone,
  type Lead,
  type Profile,
  type SmsMessage,
} from "@/lib/data/types";
import { sendSms } from "@/lib/actions/sms";

type Conversation = {
  key: string;
  leadId: string | null;
  name: string;
  phone: string;
  messages: SmsMessage[];
};

export function ReplyInboxView({
  messages,
  leads,
  reps,
  canWrite,
}: {
  messages: SmsMessage[];
  leads: Lead[];
  reps: Profile[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetLeadId = searchParams.get("leadId");
  const targetPhone = searchParams.get("phone");
  const targetBody = searchParams.get("body");

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [consumedTargetKey, setConsumedTargetKey] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const conversations = useMemo(() => {
    const map = new Map<string, Conversation>();
    for (const m of messages) {
      const counterpartyPhone = m.direction === "inbound" ? m.from_number : m.to_number;
      const key = m.lead_id ?? `phone:${normalizePhone(counterpartyPhone)}`;
      let convo = map.get(key);
      if (!convo) {
        // Fall back to matching by phone number when the message was never
        // linked to a lead record -- like caller ID matching a saved
        // contact even when the call system itself has no contact ID.
        // Some conversations are with a rep's own phone (e.g. the "Text
        // Rep Info" appointment nudges), not a lead, so check both.
        const lead = m.lead_id
          ? leads.find((l) => l.id === m.lead_id) ?? null
          : leads.find((l) => l.phone && normalizePhone(l.phone) === normalizePhone(counterpartyPhone)) ??
            null;
        const rep = !lead
          ? reps.find((r) => r.phone && normalizePhone(r.phone) === normalizePhone(counterpartyPhone)) ??
            null
          : null;
        convo = {
          key,
          leadId: m.lead_id ?? lead?.id ?? null,
          name: lead
            ? leadDisplayName(lead)
            : rep
              ? `👷 ${rep.name || rep.email}`
              : counterpartyPhone,
          phone: lead?.phone || counterpartyPhone,
          messages: [],
        };
        map.set(key, convo);
      }
      convo.messages.push(m);
    }

    if (targetLeadId && !map.has(targetLeadId)) {
      const lead = leads.find((l) => l.id === targetLeadId) ?? null;
      map.set(targetLeadId, {
        key: targetLeadId,
        leadId: targetLeadId,
        name: lead ? leadDisplayName(lead) : targetPhone || "New conversation",
        phone: lead?.phone || targetPhone || "",
        messages: [],
      });
    } else if (!targetLeadId && targetPhone) {
      const key = `phone:${normalizePhone(targetPhone)}`;
      if (!map.has(key)) {
        map.set(key, { key, leadId: null, name: targetPhone, phone: targetPhone, messages: [] });
      }
    }

    return [...map.values()].sort((a, b) => {
      const aLast = a.messages[a.messages.length - 1]?.created_at ?? "";
      const bLast = b.messages[b.messages.length - 1]?.created_at ?? "";
      return bLast.localeCompare(aLast);
    });
  }, [messages, leads, reps, targetLeadId, targetPhone]);

  const targetKey = targetLeadId ?? (targetPhone ? `phone:${normalizePhone(targetPhone)}` : null);
  if (targetKey && targetKey !== consumedTargetKey) {
    setConsumedTargetKey(targetKey);
    setSelectedKey(targetKey);
    if (targetBody) setReply(targetBody);
  }

  useEffect(() => {
    if (targetLeadId || targetPhone) {
      router.replace("/reply-inbox", { scroll: false });
    }
  }, [targetLeadId, targetPhone, router]);

  const selected = conversations.find((c) => c.key === selectedKey) ?? conversations[0] ?? null;

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
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Reply Inbox</h1>
          <p className="module-sub">{conversations.length} conversations</p>
        </div>
      </div>

      {conversations.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">No messages yet</p>
          <p className="empty-hint">
            Incoming texts to your Twilio number will show up here.
          </p>
        </div>
      ) : (
        <div className="ri-layout">
          <div className="ri-list">
            {conversations.map((c) => {
              const last = c.messages[c.messages.length - 1];
              return (
                <div
                  key={c.key}
                  className={
                    "ri-list-item" + (selected?.key === c.key ? " ri-list-item-active" : "")
                  }
                  onClick={() => setSelectedKey(c.key)}
                >
                  <div className="ri-list-name">{c.name}</div>
                  <div className="ri-list-snippet">
                    {last?.body || "No messages yet"}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="ri-thread">
            {selected ? (
              <>
                <div className="ri-thread-head">
                  <div className="ri-thread-name">{selected.name}</div>
                  <div className="ri-thread-phone">{selected.phone}</div>
                </div>
                <div className="ri-thread-messages">
                  {selected.messages.length === 0 ? (
                    <p className="empty-hint">No messages yet — send the first one below.</p>
                  ) : (
                    selected.messages.map((m) => (
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
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {canWrite && (
                  <div className="ri-reply-bar">
                    <textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Type a reply..."
                      rows={2}
                    />
                    <button className="btn-primary" onClick={handleSend} disabled={pending}>
                      {pending ? "Sending…" : "Send"}
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
