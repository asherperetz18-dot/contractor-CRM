import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addDismissedShare,
  offerFor,
  parseDismissedShares,
  shareIdFromEndRequest,
} from "./screen-share-session.ts";

/**
 * "Every time I refresh I get Vanessa's screen share invite": a session
 * whose sharer's tab was gone kept knocking on every reload, because
 * "Not now" lived only in the page's memory and the sharer's goodbye
 * rode a Server Action that the closing page abandoned.
 */

const ME = "11111111-1111-4111-8111-111111111111";
const VANESSA = "22222222-2222-4222-8222-222222222222";
const SAM = "33333333-3333-4333-8333-333333333333";

const share = (id: string, sharerId: string, invitedTo: string | null) => ({ id, sharerId, invitedTo });
const INVITE = share("aaaaaaaa-0000-4000-8000-000000000001", VANESSA, ME);
const OPEN = share("aaaaaaaa-0000-4000-8000-000000000002", SAM, null);

test("Not now on an invite still holds after the page reloads", () => {
  // what "Not now" writes, read back the way a fresh page load reads it
  const saved = JSON.stringify(addDismissedShare([], INVITE.id));
  const afterReload = parseDismissedShares(saved);
  assert.equal(offerFor([INVITE], ME, afterReload), null);
});

test("a new session from the same teammate still knocks", () => {
  const dismissed = addDismissedShare([], INVITE.id);
  const fresh = share("aaaaaaaa-0000-4000-8000-000000000003", VANESSA, ME);
  assert.equal(offerFor([fresh, INVITE], ME, dismissed), fresh);
});

test("an invite aimed at me outranks an open share, and turning it down falls back to the open one", () => {
  assert.equal(offerFor([OPEN, INVITE], ME, []), INVITE);
  assert.equal(offerFor([OPEN, INVITE], ME, [INVITE.id]), OPEN);
  assert.equal(offerFor([OPEN, INVITE], ME, [INVITE.id, OPEN.id]), null);
});

test("my own session is never offered back to me", () => {
  assert.equal(offerFor([share("aaaaaaaa-0000-4000-8000-000000000004", ME, null)], ME, []), null);
});

test("the remembered list ignores junk and keeps only the newest few", () => {
  assert.deepEqual(parseDismissedShares(null), []);
  assert.deepEqual(parseDismissedShares("not json"), []);
  assert.deepEqual(parseDismissedShares('{"a":1}'), []);
  assert.deepEqual(parseDismissedShares('["x", 7, null, "y"]'), ["x", "y"]);

  let list: string[] = [];
  for (let i = 0; i < 30; i++) list = addDismissedShare(list, `id-${i}`);
  assert.equal(list.length, 20);
  assert.equal(list.at(-1), "id-29");
  assert.ok(!list.includes("id-0"));
  // turning the same one down twice doesn't spend a slot
  assert.deepEqual(addDismissedShare(["a", "b"], "a"), ["b", "a"]);
});

test("the end beacon only accepts a session id", () => {
  assert.equal(shareIdFromEndRequest({ id: INVITE.id }), INVITE.id);
  assert.equal(shareIdFromEndRequest({ id: "nope" }), null);
  assert.equal(shareIdFromEndRequest({ id: 42 }), null);
  assert.equal(shareIdFromEndRequest(null), null);
  assert.equal(shareIdFromEndRequest("x"), null);
});

test("a sharer leaving the page ends the session by beacon, never a Server Action", () => {
  // A Server Action fired as the page goes away waits behind any other
  // action in the queue and dies with the page -- the row stayed "live"
  // and knocked on the invitee's screen for up to 4 hours.
  const src = readFileSync(join(import.meta.dirname, "..", "app", "(app)", "screen-share.tsx"), "utf8");
  assert.doesNotMatch(src, /\bendScreenShare\b/);
  assert.match(src, /"\/api\/screen-shares\/end"/);
  // pagehide fires on reload and close everywhere, iPhone included;
  // beforeunload never fires on iOS
  assert.match(src, /addEventListener\("pagehide"/);
});
