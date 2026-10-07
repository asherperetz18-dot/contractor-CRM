import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { financingChip, leadFinancing } from "./financing.ts";

/**
 * Financing on the pipeline (DECISIONS #165): each card shows where its
 * customer's financing stands, from the newest step on any of the lead's
 * live estimates, and how long it's been there.
 */

const est = (id: string, lead_id: string | null, status = "Sent", kind: string | null = "contract", doc_number = id.toUpperCase()) => ({
  id,
  lead_id,
  status,
  kind,
  doc_number,
});
const step = (estimate_id: string, status: string, created_at: string) => ({ estimate_id, status, created_at });

test("the newest step on any of the lead's estimates is where it stands", () => {
  const byLead = leadFinancing(
    [est("e1", "L1"), est("e2", "L1", "Signed"), est("e3", "L2")],
    [
      step("e1", "sent", "2026-10-01T10:00:00Z"),
      step("e1", "applied", "2026-10-02T10:00:00Z"),
      step("e2", "approved", "2026-10-04T10:00:00Z"),
      step("e3", "sent", "2026-10-03T10:00:00Z"),
    ]
  );
  assert.deepEqual(byLead.L1, { status: "approved", at: "2026-10-04T10:00:00Z", docNumber: "E2" });
  assert.deepEqual(byLead.L2, { status: "sent", at: "2026-10-03T10:00:00Z", docNumber: "E3" });
  assert.equal(Object.keys(byLead).length, 2);
});

test("only live estimates count: not a draft, a void or declined one, or an invoice", () => {
  const byLead = leadFinancing(
    [
      est("void", "L1", "Void"),
      est("declined", "L2", "Declined"),
      est("draft", "L3", "Draft"),
      est("inv", "L4", "Sent", "invoice"),
      est("live", "L5", "Viewed", null),
    ],
    [
      step("void", "applied", "2026-10-01T10:00:00Z"),
      step("declined", "applied", "2026-10-01T10:00:00Z"),
      step("draft", "sent", "2026-10-01T10:00:00Z"),
      step("inv", "funded", "2026-10-01T10:00:00Z"),
      step("live", "declined", "2026-10-01T10:00:00Z"),
    ]
  );
  assert.deepEqual(Object.keys(byLead), ["L5"]);
  assert.equal(byLead.L5.status, "declined");
});

test("a step on an estimate the person can't see, with no lead, or of no known status shows nothing", () => {
  const byLead = leadFinancing(
    [est("e1", null), est("e2", "L2")],
    [step("e1", "sent", "2026-10-01T10:00:00Z"), step("hidden", "applied", "2026-10-01T10:00:00Z"), step("e2", "bogus", "2026-10-01T10:00:00Z")]
  );
  assert.deepEqual(byLead, {});
});

test("the chip: the step's name, how long it's been, and whether it's waiting, good or bad", () => {
  const f = (status: "sent" | "applied" | "approved" | "declined" | "funded") => ({ status, at: "x", docNumber: "EST-1047" });
  assert.deepEqual(financingChip(f("sent"), 0), {
    text: "Financing: Link sent · today",
    title: "EST-1047: Link sent today",
    tone: "waiting",
  });
  assert.deepEqual(financingChip(f("applied"), 1), {
    text: "Financing: Applied · 1d",
    title: "EST-1047: Applied 1 day ago",
    tone: "waiting",
  });
  assert.equal(financingChip(f("approved"), 6).tone, "good");
  assert.equal(financingChip(f("funded"), 6).tone, "good");
  assert.equal(financingChip(f("declined"), 6).tone, "bad");
  assert.equal(financingChip(f("approved"), 6).title, "EST-1047: Approved 6 days ago");
  // A step dated ahead of this clock reads as today, never "-1d".
  assert.equal(financingChip(f("sent"), -1).text, "Financing: Link sent · today");
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("loaded with the estimates the pipeline already has, and shown on both boards", () => {
  const index = source("./data/lead-estimate-index.ts");
  assert.match(index, /\.from\("estimate_financing_events"\)\s*\.select\("estimate_id, status, created_at"\)\s*\.eq\("company_id", profile\.company_id\)/);
  assert.match(index, /leadFinancing\(/);
  assert.match(index, /financing\?: LeadFinancing/);

  const board = source("../app/(app)/pipeline/pipeline-board.tsx");
  assert.match(board, /lead-card-financing/);
  assert.match(board, /byLead=\{estimateIndex\.byLead\}/);
  const phone = source("../app/(app)/pipeline/phone-lead-list.tsx");
  assert.match(phone, /pl-fin/);

  // A link sent changes the card too.
  const actions = source("./actions/financing.ts");
  const send = actions.slice(actions.indexOf("export async function sendFinancingLink("));
  assert.match(send, /revalidatePath\("\/pipeline"\)/);
});
