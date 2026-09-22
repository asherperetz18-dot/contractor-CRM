import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterInviteHistory,
  inviteStatus,
  INVITE_STATUS_LABEL,
  type InviteHistoryRow,
} from "./invite-history.ts";

const NOW = new Date("2026-09-22T12:00:00Z").getTime();
const DAY = 86400000;

function row(over: Partial<InviteHistoryRow> = {}): InviteHistoryRow {
  return {
    id: "inv-1",
    email: "owner@theirbusiness.com",
    company_name: null,
    source: "manual",
    created_at: new Date(NOW - DAY).toISOString(),
    invite_sent_at: new Date(NOW - DAY).toISOString(),
    expires_at: new Date(NOW + 6 * DAY).toISOString(),
    consumed_at: null,
    company_id: null,
    sent_by_name: "Asher",
    ...over,
  };
}

test("a redeemed invite is Set up, whatever its expiry says", () => {
  const r = row({ consumed_at: new Date(NOW - DAY / 2).toISOString(), company_id: "co-1", expires_at: new Date(NOW - DAY).toISOString() });
  assert.equal(inviteStatus(r, NOW), "set_up");
});

test("a sent, unopened, unexpired invite is Pending", () => {
  assert.equal(inviteStatus(row(), NOW), "pending");
});

test("a sent invite past its expiry that nobody opened is Expired", () => {
  assert.equal(inviteStatus(row({ expires_at: new Date(NOW - 1000).toISOString() }), NOW), "expired");
});

test("a row whose email never went out is Send failed, even inside the expiry window", () => {
  assert.equal(inviteStatus(row({ invite_sent_at: null }), NOW), "send_failed");
});

test("every status has a label to show", () => {
  for (const s of ["set_up", "pending", "expired", "send_failed"] as const) {
    assert.ok(INVITE_STATUS_LABEL[s].length > 0);
  }
});

test("filter by status tab and by email or company text, case-insensitively", () => {
  const rows = [
    row({ id: "a", email: "alice@one.com" }),
    row({ id: "b", email: "bob@two.com", consumed_at: new Date(NOW - DAY / 2).toISOString(), company_name: "Two Roofing" }),
    row({ id: "c", email: "carl@three.com", expires_at: new Date(NOW - 1000).toISOString() }),
  ];
  assert.deepEqual(filterInviteHistory(rows, "all", "", NOW).map((r) => r.id), ["a", "b", "c"]);
  assert.deepEqual(filterInviteHistory(rows, "pending", "", NOW).map((r) => r.id), ["a"]);
  assert.deepEqual(filterInviteHistory(rows, "set_up", "", NOW).map((r) => r.id), ["b"]);
  assert.deepEqual(filterInviteHistory(rows, "expired", "", NOW).map((r) => r.id), ["c"]);
  assert.deepEqual(filterInviteHistory(rows, "all", "  ROOFING ", NOW).map((r) => r.id), ["b"]);
  assert.deepEqual(filterInviteHistory(rows, "all", "carl", NOW).map((r) => r.id), ["c"]);
  assert.deepEqual(filterInviteHistory(rows, "pending", "bob", NOW).map((r) => r.id), []);
});
