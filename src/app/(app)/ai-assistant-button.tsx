"use client";

import { useState, useRef, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { askAssistant, type ChatMessage } from "@/lib/actions/ai-assistant";
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
    const result = await askAssistant(nextMessages);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessages((prev) => {
      const next: ChatMessage[] = [...prev, { role: "assistant", content: result.reply || "" }];
      if (result.proposals?.length) {
        const index = next.length - 1;
        setProposals((p) => ({ ...p, [index]: result.proposals! }));
      }
      return next;
    });
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
                  Ask about your leads, pipeline, or schedule — e.g. &ldquo;how many open leads do I
                  have&rdquo; or &ldquo;what&apos;s on my calendar this week&rdquo;.
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
              {pending && (
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
