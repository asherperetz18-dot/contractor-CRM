import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crmTimesFromGoogle,
  decidePull,
  eventWanted,
  googleEventBody,
  planPush,
  type GoogleEvent,
  type SyncEvent,
  type SyncLink,
} from "./sync-plan.ts";

const LA = "America/Los_Angeles";
const REP = "rep-1";
const OTHER = "rep-2";
const CRM = "https://crm.example.com";

function ev(over: Partial<SyncEvent> = {}): SyncEvent {
  return {
    id: "ev-1",
    title: null,
    date: "2026-09-25",
    time: "09:00:00",
    end_time: "10:30:00",
    event_type: "Estimate",
    status: "New",
    assigned_to: REP,
    second_assigned_to: null,
    notes: "Gate code 1234",
    updated_at: "2026-09-20T10:00:00.000Z",
    lead: {
      contact_type: "Individual",
      company_name: null,
      first_name: "Maria",
      last_name: "Lopez",
      phone: "(310) 555-0142",
      address: "12 Ocean Ave, Santa Monica, CA",
    },
    ...over,
  };
}

function link(over: Partial<SyncLink> = {}): SyncLink {
  return {
    event_id: "ev-1",
    google_event_id: "g-1",
    google_etag: '"etag-1"',
    crm_updated_at: "2026-09-20T10:00:00.000Z",
    ...over,
  };
}

// ── What Google gets ────────────────────────────────────────────────

test("a timed appointment becomes a zoned dateTime pair, DST-correct", () => {
  const body = googleEventBody(ev(), LA, CRM);
  assert.equal(body.start.dateTime, "2026-09-25T16:00:00.000Z"); // 9:00 PDT
  assert.equal(body.end.dateTime, "2026-09-25T17:30:00.000Z");
  assert.equal(body.start.timeZone, LA);
  assert.equal(body.extendedProperties.private.crm_event_id, "ev-1");
});

test("no end time means one hour; no start time means an all-day event", () => {
  const hour = googleEventBody(ev({ end_time: null }), LA, CRM);
  assert.equal(hour.end.dateTime, "2026-09-25T17:00:00.000Z");
  const allDay = googleEventBody(ev({ time: null, end_time: null }), LA, CRM);
  assert.equal(allDay.start.date, "2026-09-25");
  assert.equal(allDay.end.date, "2026-09-26");
  assert.equal(allDay.start.dateTime, undefined);
});

test("the summary names the calendar and the client; the description carries phone, address, notes and the CRM link", () => {
  const body = googleEventBody(ev({ title: "Kitchen remodel" }), LA, CRM);
  assert.equal(body.summary, "Estimate: Maria Lopez — Kitchen remodel");
  assert.equal(body.location, "12 Ocean Ave, Santa Monica, CA");
  assert.match(body.description, /\(310\) 555-0142/);
  assert.match(body.description, /Gate code 1234/);
  assert.match(body.description, /https:\/\/crm\.example\.com\/calendar\?openEvent=ev-1/);
  const noLead = googleEventBody(ev({ lead: null, title: null }), LA, CRM);
  assert.equal(noLead.summary, "Estimate");
});

// ── What comes back from Google ─────────────────────────────────────

test("a Google dateTime pair reads back as the company's local date, time and end time", () => {
  const g: GoogleEvent = {
    id: "g-1",
    start: { dateTime: "2026-09-25T16:00:00Z" },
    end: { dateTime: "2026-09-25T17:30:00Z" },
  };
  assert.deepEqual(crmTimesFromGoogle(g, LA), { date: "2026-09-25", time: "09:00", end_time: "10:30" });
  // An offset form is the same instant.
  const offset: GoogleEvent = { id: "g-1", start: { dateTime: "2026-09-25T09:00:00-07:00" }, end: { dateTime: "2026-09-25T10:00:00-07:00" } };
  assert.deepEqual(crmTimesFromGoogle(offset, LA), { date: "2026-09-25", time: "09:00", end_time: "10:00" });
});

test("an all-day Google event has no times; an end on another day drops the end time", () => {
  assert.deepEqual(crmTimesFromGoogle({ id: "g", start: { date: "2026-09-25" }, end: { date: "2026-09-26" } }, LA), {
    date: "2026-09-25",
    time: null,
    end_time: null,
  });
  const overnight: GoogleEvent = { id: "g", start: { dateTime: "2026-09-25T22:00:00-07:00" }, end: { dateTime: "2026-09-26T01:00:00-07:00" } };
  assert.deepEqual(crmTimesFromGoogle(overnight, LA), { date: "2026-09-25", time: "22:00", end_time: null });
  assert.equal(crmTimesFromGoogle({ id: "g" }, LA), null);
});

// ── Scope ───────────────────────────────────────────────────────────

test("a rep's connection wants only their own seats; the company connection wants everything live", () => {
  assert.equal(eventWanted(ev(), { profile_id: REP }), true);
  assert.equal(eventWanted(ev({ assigned_to: OTHER, second_assigned_to: REP }), { profile_id: REP }), true);
  assert.equal(eventWanted(ev({ assigned_to: OTHER }), { profile_id: REP }), false);
  assert.equal(eventWanted(ev({ assigned_to: OTHER }), { profile_id: null }), true);
  assert.equal(eventWanted(ev({ status: "Cancelled" }), { profile_id: null }), false);
  assert.equal(eventWanted(ev({ status: "No-show" }), { profile_id: REP }), false);
});

// ── Push plan ───────────────────────────────────────────────────────

test("push: create the unlinked, update the changed, leave the unchanged, remove the dead, gone and reassigned", () => {
  const events = [
    ev({ id: "new" }),
    ev({ id: "changed", updated_at: "2026-09-21T00:00:00.000Z" }),
    ev({ id: "same" }),
    ev({ id: "dead", status: "Cancelled" }),
    ev({ id: "moved", assigned_to: OTHER }),
    ev({ id: "old", date: "2026-01-05" }),
    ev({ id: "old-changed", date: "2026-01-05", updated_at: "2026-09-21T00:00:00.000Z" }),
  ];
  const links = [
    link({ event_id: "changed", google_event_id: "g-changed" }),
    link({ event_id: "same", google_event_id: "g-same" }),
    link({ event_id: "dead", google_event_id: "g-dead" }),
    link({ event_id: "moved", google_event_id: "g-moved" }),
    link({ event_id: "gone", google_event_id: "g-gone" }),
    link({ event_id: "old-changed", google_event_id: "g-old" }),
  ];
  const plan = planPush(events, links, { profile_id: REP }, "2026-09-18");
  assert.deepEqual(plan.creates.map((e) => e.id), ["new"]);
  assert.deepEqual(plan.updates.map((u) => u.event.id).sort(), ["changed", "old-changed"]);
  assert.deepEqual(plan.removes.map((l) => l.google_event_id).sort(), ["g-dead", "g-gone", "g-moved"]);
  // "old" is before the window and unlinked: never created, never touched.
});

// ── Pull decision ───────────────────────────────────────────────────

test("pull: our own write echoing back is skipped by etag", () => {
  const g: GoogleEvent = { id: "g-1", etag: '"etag-1"', updated: "2026-09-22T00:00:00Z", start: { dateTime: "2026-09-26T16:00:00Z" }, end: { dateTime: "2026-09-26T17:00:00Z" } };
  assert.equal(decidePull(g, link(), ev(), LA).kind, "skip");
});

test("pull: a move in Google reschedules the CRM appointment", () => {
  const g: GoogleEvent = { id: "g-1", etag: '"etag-2"', updated: "2026-09-22T00:00:00Z", start: { dateTime: "2026-09-26T16:00:00Z" }, end: { dateTime: "2026-09-26T17:00:00Z" } };
  assert.deepEqual(decidePull(g, link(), ev(), LA), { kind: "reschedule", date: "2026-09-26", time: "09:00", end_time: "10:00" });
});

test("pull: the same times under a new etag is nothing to do", () => {
  const g: GoogleEvent = { id: "g-1", etag: '"etag-2"', updated: "2026-09-22T00:00:00Z", start: { dateTime: "2026-09-25T16:00:00Z" }, end: { dateTime: "2026-09-25T17:30:00Z" } };
  assert.equal(decidePull(g, link(), ev(), LA).kind, "skip");
});

test("pull: cancelled in Google cancels in the CRM, unless it's already dead", () => {
  const g: GoogleEvent = { id: "g-1", etag: '"etag-2"', status: "cancelled", updated: "2026-09-22T00:00:00Z" };
  assert.equal(decidePull(g, link(), ev(), LA).kind, "cancel");
  assert.equal(decidePull(g, link(), ev({ status: "No-show" }), LA).kind, "skip");
});

test("pull: when both sides changed, the later edit wins", () => {
  const crmLater = ev({ updated_at: "2026-09-23T00:00:00.000Z" });
  const gEarlier: GoogleEvent = { id: "g-1", etag: '"etag-2"', updated: "2026-09-22T00:00:00Z", start: { dateTime: "2026-09-26T16:00:00Z" }, end: { dateTime: "2026-09-26T17:00:00Z" } };
  assert.equal(decidePull(gEarlier, link(), crmLater, LA).kind, "skip");
  const gLater: GoogleEvent = { ...gEarlier, updated: "2026-09-24T00:00:00Z" };
  assert.equal(decidePull(gLater, link(), crmLater, LA).kind, "reschedule");
});

test("pull: a Google event whose CRM appointment is gone is skipped (the push removes it)", () => {
  const g: GoogleEvent = { id: "g-1", etag: '"etag-2"', start: { dateTime: "2026-09-26T16:00:00Z" }, end: { dateTime: "2026-09-26T17:00:00Z" } };
  assert.equal(decidePull(g, link(), null, LA).kind, "skip");
});
