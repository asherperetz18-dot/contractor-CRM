import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { metered } from "./metered.ts";

// The counted client broke every streamed answer: the SDK's own stream()
// calls messages.create(...).withResponse(), and the counting wrapper
// handed it a plain promise instead -- so the assistant chat answered
// "The AI is temporarily unavailable" to everything. These run a real
// SDK client against a fake API, so the SDK's internals are exercised.

const request = {
  model: "claude-opus-5",
  max_tokens: 64,
  messages: [{ role: "user" as const, content: "Add a task" }],
};

function fakeApi(): Anthropic {
  const start = {
    type: "message_start",
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 120, output_tokens: 1 },
    },
  };
  const frames = [
    start,
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Which lead?" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ];
  const fetch = async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.stream) {
      const sse = frames.map((f) => `event: ${f.type}\ndata: ${JSON.stringify(f)}\n\n`).join("");
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({
      ...start.message,
      content: [{ type: "text", text: "Which lead?" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 120, output_tokens: 5 },
    });
  };
  return new Anthropic({ apiKey: "test", fetch, maxRetries: 0 });
}

test("a streamed answer streams through the counted client, counted once", async () => {
  const counted: unknown[] = [];
  const client = metered(fakeApi(), async (usage) => {
    counted.push(usage);
  });

  const stream = client.messages.stream(request);
  let text = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") text += event.delta.text;
  }
  await stream.finalMessage();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(text, "Which lead?");
  assert.deepEqual(counted, [{ input_tokens: 120, output_tokens: 5 }]);
});

test("a whole answer comes back unchanged, counted once", async () => {
  const counted: unknown[] = [];
  const client = metered(fakeApi(), async (usage) => {
    counted.push(usage);
  });

  const message = await client.messages.create(request);

  assert.deepEqual(message.content, [{ type: "text", text: "Which lead?" }]);
  assert.deepEqual(counted, [{ input_tokens: 120, output_tokens: 5 }]);
});
