import { test } from "node:test";
import assert from "node:assert/strict";
import { driveTrashRequest } from "./drive-trash.ts";

/**
 * A photo deleted in the CRM goes to the Drive trash, never straight
 * past it: Drive keeps trashed files 30 days, so a wrong tap can be
 * undone from Drive. A DELETE on the file skips the trash for good.
 */

test("trashing is a PATCH that sets trashed, not a DELETE", () => {
  const { url, init } = driveTrashRequest("abc123", "tok");
  assert.equal(url, "https://www.googleapis.com/drive/v3/files/abc123");
  assert.equal(init.method, "PATCH");
  assert.deepEqual(JSON.parse(String(init.body)), { trashed: true });
  assert.deepEqual(init.headers, {
    Authorization: "Bearer tok",
    "Content-Type": "application/json",
  });
});

test("the file id is escaped, so it can't point the call somewhere else", () => {
  const { url } = driveTrashRequest("a/../b?x=1", "tok");
  assert.equal(url, "https://www.googleapis.com/drive/v3/files/a%2F..%2Fb%3Fx%3D1");
});
