import { test } from "node:test";
import assert from "node:assert/strict";
import { recordingResponseInit, upstreamRecordingHeaders } from "./recording-range.ts";

/**
 * A recording is only seekable when the proxy answers a "Range:" request
 * with the provider's own 206 and Content-Range. Serve a plain 200 with
 * no length instead and Chrome greys the timeline out: the player can
 * play from the start and nothing else. These pin the passthrough.
 */

test("the browser's Range header rides along on the upstream fetch, beside the auth header", () => {
  assert.deepEqual(upstreamRecordingHeaders("bytes=1024-", { Authorization: "Basic abc" }), {
    Authorization: "Basic abc",
    Range: "bytes=1024-",
  });
});

test("no Range from the browser means no Range upstream -- the whole file, as before", () => {
  assert.deepEqual(upstreamRecordingHeaders(null, { Authorization: "Basic abc" }), {
    Authorization: "Basic abc",
  });
  assert.deepEqual(upstreamRecordingHeaders(null), {});
});

test("a 206 slice comes back as a 206 with its Content-Range and Content-Length", () => {
  const init = recordingResponseInit({
    status: 206,
    headers: new Headers({
      "content-type": "audio/mpeg",
      "content-range": "bytes 1024-2047/4096",
      "content-length": "1024",
    }),
  });
  assert.equal(init.status, 206);
  assert.equal(init.headers["Content-Type"], "audio/mpeg");
  assert.equal(init.headers["Content-Range"], "bytes 1024-2047/4096");
  assert.equal(init.headers["Content-Length"], "1024");
  assert.equal(init.headers["Accept-Ranges"], "bytes");
});

test("a whole-file 200 stays a 200, still advertising ranges so a later seek asks for a slice", () => {
  const init = recordingResponseInit({
    status: 200,
    headers: new Headers({ "content-type": "audio/x-wav", "content-length": "4096" }),
  });
  assert.equal(init.status, 200);
  assert.equal(init.headers["Content-Type"], "audio/x-wav");
  assert.equal(init.headers["Content-Length"], "4096");
  assert.equal(init.headers["Accept-Ranges"], "bytes");
  assert.equal("Content-Range" in init.headers, false);
});

test("audio/mpeg is assumed when the provider names no type, and the reply is private-cacheable", () => {
  const init = recordingResponseInit({ status: 200, headers: new Headers() });
  assert.equal(init.headers["Content-Type"], "audio/mpeg");
  assert.equal(init.headers["Cache-Control"], "private, max-age=3600");
  assert.equal("Content-Length" in init.headers, false);
});

test("a compressed upstream body drops its Content-Length -- fetch inflates it, so the count would lie", () => {
  const init = recordingResponseInit({
    status: 200,
    headers: new Headers({ "content-length": "900", "content-encoding": "gzip" }),
  });
  assert.equal("Content-Length" in init.headers, false);
});

test("any other 2xx is served as a plain 200 (a 203 or 204 upstream is not a slice)", () => {
  assert.equal(recordingResponseInit({ status: 203, headers: new Headers() }).status, 200);
});
