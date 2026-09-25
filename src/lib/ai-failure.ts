import Anthropic from "@anthropic-ai/sdk";
import { aiFailureMessage } from "./data/assistant-stream.ts";

/**
 * What a failed Claude call says to the person, from the error it threw.
 * Server-only (it imports the SDK); the chat route and the estimate's AI
 * buttons share it so a rejected key, an empty credit balance and an
 * outage each read differently on screen.
 */
export function aiFailureFromError(error: unknown): string {
  const connection = error instanceof Anthropic.APIConnectionError;
  if (!connection && error instanceof Anthropic.APIError) {
    // The API's own reason sits in the JSON body; error.message is that
    // body stringified behind the status ("400 {"type":"error",...}").
    const body = error.error as { error?: { message?: unknown } } | undefined;
    const reason = typeof body?.error?.message === "string" ? body.error.message : error.message;
    return aiFailureMessage(error.status, false, reason);
  }
  return aiFailureMessage(undefined, connection);
}
