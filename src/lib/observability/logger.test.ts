import { test } from "node:test";
import assert from "node:assert/strict";
import { logError, logInfo } from "./logger.ts";

function captureConsole(run: () => void): { log: string[]; error: string[] } {
  const originalLog = console.log;
  const originalError = console.error;
  const captured = { log: [] as string[], error: [] as string[] };
  console.log = ((...args: unknown[]) => captured.log.push(String(args[0]))) as typeof console.log;
  console.error = ((...args: unknown[]) => captured.error.push(String(args[0]))) as typeof console.error;
  try {
    run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return captured;
}

test("logInfo writes one structured JSON line to stdout", () => {
  const { log, error } = captureConsole(() => {
    logInfo({ event: "call_requested", route: "voice-dialer" });
  });
  assert.equal(log.length, 1);
  assert.equal(error.length, 0);
  const parsed = JSON.parse(log[0]);
  assert.equal(parsed.event, "call_requested");
  assert.equal(parsed.route, "voice-dialer");
  assert.equal(parsed.level, "info");
  assert.equal(typeof parsed.timestamp, "string");
  assert.equal(typeof parsed.environment, "string");
});

test("logError writes to stderr, not stdout, so severity is visible at the stream level", () => {
  const { log, error } = captureConsole(() => {
    logError({ event: "twiml_failed", route: "api/voice/twiml" });
  });
  assert.equal(log.length, 0);
  assert.equal(error.length, 1);
  assert.equal(JSON.parse(error[0]).level, "error");
});

test("every log line is scrubbed for secret-shaped fields before it's serialised", () => {
  const { log } = captureConsole(() => {
    logInfo({ event: "token_created", authToken: "shh", safe: "ok" });
  });
  const parsed = JSON.parse(log[0]);
  assert.equal("authToken" in parsed, false);
  assert.equal(parsed.safe, "ok");
});
