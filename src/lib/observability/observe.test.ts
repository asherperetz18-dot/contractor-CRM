import { test } from "node:test";
import assert from "node:assert/strict";
import { runObserved, withActionObservability } from "./observe.ts";

function captureConsole(run: () => Promise<unknown>): Promise<{ log: string[]; error: string[]; result?: unknown; thrown?: unknown }> {
  const originalLog = console.log;
  const originalError = console.error;
  const captured: { log: string[]; error: string[] } = { log: [], error: [] };
  console.log = ((...args: unknown[]) => captured.log.push(String(args[0]))) as typeof console.log;
  console.error = ((...args: unknown[]) => captured.error.push(String(args[0]))) as typeof console.error;
  return run()
    .then((result) => ({ ...captured, result }))
    .catch((thrown) => ({ ...captured, thrown }))
    .finally(() => {
      console.log = originalLog;
      console.error = originalError;
    });
}

test("runObserved returns the wrapped function's result and logs one completion line", async () => {
  const { log, error, result } = await captureConsole(() =>
    runObserved({ name: "test.op", correlationId: "cid-1", fn: async () => "ok" })
  );
  assert.equal(result, "ok");
  assert.equal(error.length, 0);
  assert.equal(log.length, 1);
  const parsed = JSON.parse(log[0]);
  assert.equal(parsed.event, "test.op.completed");
  assert.equal(parsed.correlationId, "cid-1");
  assert.equal(typeof parsed.durationMs, "number");
});

test("runObserved logs a failure line and rethrows the original error unchanged", async () => {
  const original = new Error("boom");
  const { log, error, thrown } = await captureConsole(() =>
    runObserved({
      name: "test.op",
      correlationId: "cid-2",
      fn: async () => {
        throw original;
      },
    })
  );
  assert.equal(thrown, original);
  assert.equal(log.length, 0);
  assert.equal(error.length, 1);
  assert.equal(JSON.parse(error[0]).event, "test.op.failed");
});

test("withActionObservability threads the given correlation id through to the log line", async () => {
  const { log } = await captureConsole(() => withActionObservability("actions.logCall", "cid-3", async () => 42));
  assert.equal(JSON.parse(log[0]).correlationId, "cid-3");
});
