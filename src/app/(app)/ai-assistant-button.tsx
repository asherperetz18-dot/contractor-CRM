"use client";

import { useState, useRef, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import {
  createAssistantEventParser,
  type AssistantStreamEvent,
  type ChatMessage,
} from "@/lib/data/assistant-stream";
import type { ProposalRow } from "@/lib/data/ai-proposals";
import { AiProposalCard } from "./ai-proposal-card";

// Proposals are pinned to the message index they arrived with, so they stay
// anchored to the exchange that produced them as the chat grows.
type ProposalsByIndex = Record<number, ProposalRow[]>;

export function AiAssistantButton() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposals, setProposals] = useState<ProposalsByIndex>({});
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function send() {
    const question = input.trim();
    if (!question || pending) return;
    setInput("");
    setError("");
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setPending(true);

    // The slot the reply will occupy, so its proposals pin to it.
    const assistantIndex = nextMessages.length;
    let reply = "";
    let streamError = "";
    let arrived: ProposalRow[] = [];

    const showReply = (text: string) => {
      setMessages((prev) => {
        const next = [...prev];
        if (next.length === assistantIndex) next.push({ role: "assistant", content: text });
        else next[assistantIndex] = { role: "assistant", content: text };
        return next;
      });
    };

    const apply = (events: AssistantStreamEvent[]) => {
      for (const event of events) {
        if (event.type === "text") {
          reply += event.text;
          showReply(reply);
        } else if (event.type === "proposals") {
          arrived = event.proposals;
        } else if (event.type === "error") {
          streamError = event.message;
        }
      }
    };

    try {
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || "The AI assistant is temporarily unavailable. Try again shortly.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = createAssistantEventParser();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        apply(parser.push(decoder.decode(value, { stream: true })));
      }
      apply(parser.flush());

      if (arrived.length) {
        setProposals((p) => ({ ...p, [assistantIndex]: arrived }));
      }
      if (streamError) setError(streamError);
    } catch {
      setError("The AI assistant is temporarily unavailable. Try again shortly.");
    } finally {
      setPending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function closeModal() {
    setOpen(false);
  }

  return (
    <>
      <button
        className="icon-btn topbar-icon-btn"
        onClick={() => setOpen(true)}
        aria-label="AI Assistant"
        title="AI Assistant"
      >
        ✨
      </button>
      {open && (
        <Modal title="AI Assistant" onClose={closeModal} wide>
          <div className="ai-chat">
            <div className="ai-chat-list" ref={listRef}>
              {messages.length === 0 && !pending && (
                <p className="hint-note">
                  Ask about your leads, schedule, estimates, projects, or money to collect — e.g.
                  &ldquo;how many open leads do I have&rdquo; or &ldquo;who still owes us
                  money&rdquo;.
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i}>
                  <div className={"ai-chat-msg ai-chat-msg-" + m.role}>
                    <div className="ai-chat-bubble">{m.content}</div>
                  </div>
                  {proposals[i]?.map((p) => (
                    <AiProposalCard key={p.id} proposal={p} />
                  ))}
                </div>
              ))}
              {pending && messages[messages.length - 1]?.role !== "assistant" && (
                <div className="ai-chat-msg ai-chat-msg-assistant">
                  <div className="ai-chat-bubble ai-chat-thinking">Thinking…</div>
                </div>
              )}
            </div>
            {error && <p className="error-note">{error}</p>}
            <div className="ai-chat-input-row">
              <textarea
                className="ai-chat-input"
                placeholder="Ask a question…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={pending}
              />
              <button className="btn-primary" onClick={send} disabled={pending || !input.trim()}>
                Send
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
