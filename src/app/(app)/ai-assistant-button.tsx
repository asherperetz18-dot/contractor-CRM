"use client";

import { useState, useRef, useEffect, useSyncExternalStore } from "react";
import { Modal } from "@/components/ui/modal";
import {
  aiFailureMessage,
  createAssistantEventParser,
  type AssistantStreamEvent,
  type ChatMessage,
} from "@/lib/data/assistant-stream";
import type { ProposalRow } from "@/lib/data/ai-proposals";
import {
  getSpeechRecognitionCtor,
  mergeTranscript,
  micErrorMessage,
  resultsToSegments,
  speakableReply,
  type SpeechRecognitionLike,
} from "@/lib/voice-input";
import { AiProposalCard } from "./ai-proposal-card";

// Proposals are pinned to the message index they arrived with, so they stay
// anchored to the exchange that produced them as the chat grows.
type ProposalsByIndex = Record<number, ProposalRow[]>;

const READ_ALOUD_KEY = "aiAssistantReadAloud";

// The read-aloud preference as a tiny external store (same shape as the
// funnel-order prefs): localStorage is read lazily on first use, the
// server snapshot is plain "off", and the sound toggle stays honest for
// a send that finishes after the state the closure froze.
let readAloudSnapshot: boolean | null = null;
const readAloudListeners = new Set<() => void>();

function readAloudCurrent(): boolean {
  if (readAloudSnapshot === null) {
    try {
      readAloudSnapshot = localStorage.getItem(READ_ALOUD_KEY) === "1";
    } catch {
      // Private mode -- the toggle just starts off.
      readAloudSnapshot = false;
    }
  }
  return readAloudSnapshot;
}

function setReadAloudPref(next: boolean) {
  readAloudSnapshot = next;
  try {
    localStorage.setItem(READ_ALOUD_KEY, next ? "1" : "0");
  } catch {
    // Preference just won't survive the tab.
  }
  readAloudListeners.forEach((listener) => listener());
}

function subscribeReadAloud(listener: () => void) {
  readAloudListeners.add(listener);
  return () => {
    readAloudListeners.delete(listener);
  };
}

const emptySubscribe = () => () => {};

export function AiAssistantButton() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposals, setProposals] = useState<ProposalsByIndex>({});
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Server snapshots say "unsupported/off", the client re-reads after
  // hydration -- so a browser without the APIs simply never shows the
  // buttons, with no setState-in-effect dance.
  const micSupported = useSyncExternalStore(
    emptySubscribe,
    () => getSpeechRecognitionCtor() !== null,
    () => false
  );
  const speakerSupported = useSyncExternalStore(
    emptySubscribe,
    () => "speechSynthesis" in window,
    () => false
  );
  const readAloud = useSyncExternalStore(subscribeReadAloud, readAloudCurrent, () => false);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      cancelReadback();
    };
  }, []);

  function cancelReadback() {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // No speech engine, nothing to cancel.
    }
  }

  function speakReply(text: string) {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(speakableReply(text));
      utterance.lang = navigator.language || "en-US";
      synth.speak(utterance);
    } catch {
      // A reply that can't be spoken is still on screen.
    }
  }

  function toggleReadAloud() {
    const next = !readAloudCurrent();
    setReadAloudPref(next);
    if (!next) cancelReadback();
  }

  function stopVoiceCapture(discard: boolean) {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognitionRef.current = null;
    setListening(false);
    try {
      // stop() lets a final transcript land (tap-to-stop still sends
      // what was heard); abort() throws the audio away (typing or a
      // manual Send took over).
      if (discard) recognition.abort();
      else recognition.stop();
    } catch {
      // Already ended.
    }
  }

  function startListening() {
    if (pending || listening) return;
    const Recognition = getSpeechRecognitionCtor();
    if (!Recognition) return;
    cancelReadback();
    setError("");
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const merged = mergeTranscript(resultsToSegments(event.results));
      setInput(merged.text);
      if (merged.isFinal && merged.text) {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        setListening(false);
        // Hands-free is the point: a finished utterance asks itself.
        send(merged.text);
      }
    };
    recognition.onerror = (event) => {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
        setListening(false);
      }
      const message = micErrorMessage(event.error);
      if (message) setError(message);
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
        setListening(false);
      }
    };
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
    }
  }

  async function send(questionOverride?: string) {
    const question = (questionOverride ?? input).trim();
    if (!question || pending) return;
    stopVoiceCapture(true);
    cancelReadback();
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
        // No JSON error body means the platform answered, not the
        // route (a timeout page, a crash) — surface the status code.
        setError(data?.error || aiFailureMessage(res.status));
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
      else if (reply && readAloudCurrent()) speakReply(reply);
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
    stopVoiceCapture(true);
    cancelReadback();
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
                  money&rdquo;.{micSupported ? " Or tap the mic and just say it." : ""}
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
                placeholder={listening ? "Listening…" : "Ask a question…"}
                value={input}
                onChange={(e) => {
                  // Typing takes over from the mic mid-capture.
                  if (listening) stopVoiceCapture(true);
                  setInput(e.target.value);
                }}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={pending}
              />
              {micSupported && (
                <button
                  type="button"
                  className={"icon-btn ai-chat-voice-btn ai-chat-mic" + (listening ? " listening" : "")}
                  onClick={() => (listening ? stopVoiceCapture(false) : startListening())}
                  disabled={pending}
                  aria-pressed={listening}
                  aria-label={listening ? "Stop and send" : "Ask by voice"}
                  title={listening ? "Stop and send" : "Ask by voice"}
                >
                  🎤
                </button>
              )}
              {speakerSupported && (
                <button
                  type="button"
                  className="icon-btn ai-chat-voice-btn ai-chat-speaker"
                  onClick={toggleReadAloud}
                  aria-pressed={readAloud}
                  aria-label={readAloud ? "Stop reading replies aloud" : "Read replies aloud"}
                  title={readAloud ? "Stop reading replies aloud" : "Read replies aloud"}
                >
                  🔊
                </button>
              )}
              <button className="btn-primary" onClick={() => send()} disabled={pending || !input.trim()}>
                Send
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
