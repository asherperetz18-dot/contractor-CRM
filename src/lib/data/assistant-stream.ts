import type { ProposalRow } from "./ai-proposals.ts";

/**
 * The wire format between /api/ai-assistant and the chat panel: one JSON
 * object per newline-terminated line (NDJSON). Chosen over SSE because
 * the request is a POST with a body (EventSource can't send one) and
 * over a bare text stream because proposals and errors have to arrive
 * as data, not prose.
 */

export type ChatMessage = { role: "user" | "assistant"; content: string };

export const MAX_HISTORY_MESSAGES = 12;
export const MAX_MESSAGE_CHARS = 4000;

export type AssistantStreamEvent =
  | { type: "text"; text: string }
  | { type: "proposals"; proposals: ProposalRow[] }
  | { type: "error"; message: string }
  | { type: "done" };

export function encodeAssistantEvent(event: AssistantStreamEvent): string {
  // JSON escapes any newline inside the payload, so the frame's own
  // terminator is the only "\n" on the wire -- the parser splits on it.
  return JSON.stringify(event) + "\n";
}

function parseLine(line: string): AssistantStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as { type?: unknown };
    if (
      parsed &&
      (parsed.type === "text" ||
        parsed.type === "proposals" ||
        parsed.type === "error" ||
        parsed.type === "done")
    ) {
      return parsed as AssistantStreamEvent;
    }
  } catch {
    // A corrupt or foreign line is dropped rather than killing the
    // stream -- the reply beats strictness here.
  }
  return null;
}

/**
 * Incremental NDJSON reader. The network cuts chunks anywhere, including
 * mid-JSON, so a trailing fragment is buffered until its newline
 * arrives; flush() handles a final line the server never terminated.
 */
export function createAssistantEventParser() {
  let buffer = "";
  return {
    push(chunk: string): AssistantStreamEvent[] {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return lines.map(parseLine).filter((e): e is AssistantStreamEvent => e !== null);
    },
    flush(): AssistantStreamEvent[] {
      const event = parseLine(buffer);
      buffer = "";
      return event ? [event] : [];
    },
  };
}

/**
 * The route's whole input validation: whatever a client posts, only
 * well-shaped chat turns reach the model -- known roles, non-empty
 * string content, each message cut at the cap, only the most recent
 * turns kept. Anything else is dropped, and a request that isn't even
 * an array validates to [] (the route answers 400).
 */
/**
 * What a failed AI call says to the person. One generic line hid a
 * production failure completely — the owner couldn't tell a rejected
 * API key from a timeout. Categories get plain words; anything unknown
 * carries its HTTP status so it can be quoted back for diagnosis.
 */
export function aiFailureMessage(
  status?: number,
  connectionIssue = false,
  detail?: string
): string {
  if (connectionIssue) {
    return "The AI service couldn't be reached from the server — likely a temporary network problem. Try again.";
  }
  if (status === 401 || status === 403) {
    return "The AI service rejected the server's key — check ANTHROPIC_API_KEY in the Vercel project settings.";
  }
  if (status === 429 || status === 529) {
    return "The AI service is busy right now — try again in a minute.";
  }
  if (typeof status === "number") {
    // The API's own reason names the offending field — first line only,
    // capped, because it's a diagnostic to quote, not an essay.
    const line = detail?.split("\n")[0]?.trim().slice(0, 160);
    return `The AI hit a server error (HTTP ${status}${line ? `: ${line}` : ""}). Try again — if it keeps happening, send Claude that message.`;
  }
  return "The AI is temporarily unavailable. Try again shortly.";
}

export function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const clean: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim();
    if (!trimmed) continue;
    clean.push({ role, content: trimmed.slice(0, MAX_MESSAGE_CHARS) });
  }
  return clean.slice(-MAX_HISTORY_MESSAGES);
}
