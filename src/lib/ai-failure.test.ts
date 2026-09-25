import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { aiFailureFromError } from "./ai-failure.ts";

// The estimate's AI buttons (Generate / Format / Price) answered every
// failure with "Couldn't reach the AI right now." -- a rejected key, an
// empty credit balance and a real outage all read the same, so the owner
// had nothing to act on. The thrown error now decides the words.

const headers = new Headers();

test("a rejected key names the setting to fix", () => {
  const err = new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key", headers);
  assert.match(aiFailureFromError(err), /ANTHROPIC_API_KEY/);
});

test("a rejected request carries the API's own reason, e.g. no credit left", () => {
  // The shape the API actually sends: the reason nested in a JSON body.
  const body = {
    type: "error",
    error: {
      type: "invalid_request_error",
      message: "Your credit balance is too low to access the Anthropic API.",
    },
  };
  const err = new Anthropic.BadRequestError(400, body, undefined, headers);
  const msg = aiFailureFromError(err);
  assert.ok(msg.includes("400"));
  assert.ok(msg.includes("Your credit balance is too low to access the Anthropic API."));
  assert.ok(!msg.includes('{"type"'), "the reason, not the raw JSON body");
});

test("a busy service says try again", () => {
  const err = new Anthropic.RateLimitError(429, undefined, "rate_limit_error", headers);
  assert.match(aiFailureFromError(err), /busy/i);
});

test("a network failure says the server couldn't reach it", () => {
  const err = new Anthropic.APIConnectionError({ message: "fetch failed" });
  assert.match(aiFailureFromError(err), /couldn't be reached/i);
});

test("a non-API error still reads as plain words", () => {
  const msg = aiFailureFromError(new Error("boom"));
  assert.ok(msg.length > 10);
  assert.ok(!msg.includes("boom"));
});
