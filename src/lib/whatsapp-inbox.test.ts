import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inboxCardActions, inboxPath, suggestJob, type InboxJob } from "./whatsapp-inbox.ts";
import { canSeePage, defaultPageVisible } from "./data/types.ts";

/**
 * The WhatsApp Inbox (DECISIONS #204): a company's general WhatsApp
 * group -- receipts, supply runs, odd photos -- isn't one job, so what
 * it posts waits in an inbox to be filed to a job, made into a bill or
 * dismissed. These tests pin the caption suggestion ("Looks like …"),
 * where an inbox copy is stored, the migration, and that every write
 * checks who's asking before it writes.
 */

const jobs: InboxJob[] = [
  {
    estimateId: "e1",
    leadId: "l1",
    label: "Nuha Ibrahim — Pool remodel",
    nameWords: ["Ibrahim"],
    address: "5420 Wortser Ave, Sherman Oaks, CA 91401, USA",
    docNumber: "EST-1089",
  },
  {
    estimateId: "e2",
    leadId: "l2",
    label: "John Smith — Bathroom remodel",
    nameWords: ["Smith"],
    address: "22 Oak Ave, Van Nuys, CA",
    docNumber: "EST-1102",
  },
  {
    estimateId: "e3",
    leadId: "l3",
    label: "Smith Builders — Office",
    nameWords: ["Smith"],
    address: "9 N Elm St, Los Angeles",
    docNumber: "EST-1200",
  },
  {
    estimateId: "e4",
    leadId: "l4",
    label: "Grace Kim — Deck",
    nameWords: ["Kim"],
    address: null,
    docNumber: null,
  },
];

test("a long street name in the caption suggests that job", () => {
  assert.deepEqual(suggestJob("Home Depot – thinset and grout for Wortser", jobs), {
    job: jobs[0],
    because: "Wortser",
  });
});

test("a short street name needs its Ave/St to count", () => {
  assert.deepEqual(suggestJob("Invoice for the oak ave plumbing rough-in", jobs), { job: jobs[1], because: "Oak Ave" });
  assert.equal(suggestJob("oak trim boards", jobs), null);
  assert.deepEqual(suggestJob("elm street dump run", jobs), { job: jobs[2], because: "Elm St" });
});

test("the job number wins, however it's written", () => {
  for (const caption of ["EST-1089 receipt", "est1089", "receipt #1089", "for 1089"]) {
    assert.deepEqual(suggestJob(caption, jobs), { job: jobs[0], because: "EST-1089" }, caption);
  }
});

test("the customer's name suggests the job", () => {
  assert.deepEqual(suggestJob("Ibrahim tile delivered", jobs), { job: jobs[0], because: "Ibrahim" });
});

test("two jobs matching is no suggestion at all", () => {
  assert.equal(suggestJob("Smith materials", jobs), null);
});

test("short names, parts of words and nothing at all suggest nothing", () => {
  assert.equal(suggestJob("Kim says hi", jobs), null);
  assert.equal(suggestJob("Wortsers", jobs), null);
  assert.equal(suggestJob("Oakland run", jobs), null);
  assert.equal(suggestJob("Dump trailer full – which job?", jobs), null);
  assert.equal(suggestJob("", jobs), null);
  assert.equal(suggestJob(null, jobs), null);
  assert.equal(suggestJob("10890 nails", jobs), null);
});

test("inboxPath: the company's own folder, one file per message, safe name", () => {
  assert.equal(inboxPath("co-1", "msg-1", "Home Depot #22.jpg"), "whatsapp-inbox/co-1/msg-1-Home_Depot_22.jpg");
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("0230 makes a group general, and only the office and production read it", () => {
  const sql = source("../../supabase/migrations/0230_whatsapp_inbox.sql");
  assert.match(sql, /add column if not exists kind text not null default 'job'/);
  assert.match(sql, /alter column estimate_id drop not null/);
  assert.match(sql, /check \(\(kind = 'job'\) = \(estimate_id is not null\)\)/);
  assert.match(sql, /kind = 'general'\s+and \(has_role_in_company\('Office', company_id\) or has_role_in_company\('Production', company_id\)\)/);
  for (const col of ["media_path", "inbox_status", "inbox_filed_as", "inbox_estimate_id", "inbox_by", "inbox_at"]) {
    assert.match(sql, new RegExp(`add column if not exists ${col}\\b`), col);
  }
  assert.match(source("./schema-drift.ts"), /0230_whatsapp_inbox\.sql/);
});

test("every inbox write checks the role, and the job, before it writes", () => {
  const actions = source("./actions/whatsapp-inbox.ts");
  const writers = [
    "fileInboxItem",
    "dismissInboxItem",
    "restoreInboxItem",
    "inboxReceiptForBill",
    "markInboxItemBilled",
    "addGeneralGroup",
    "removeGeneralGroup",
  ];
  for (const name of writers) {
    const start = actions.indexOf(`export async function ${name}(`);
    assert.ok(start > 0, `${name} exists`);
    const next = actions.indexOf("\nexport ", start + 1);
    const body = actions.slice(start, next > 0 ? next : undefined);
    const write = body.search(/\.(upsert|update|delete|insert|upload|copy)\(/);
    assert.ok(write > 0, `${name} writes`);
    const gate = body.search(/require(Sorter|Admin)\(\)/);
    assert.ok(gate > 0 && gate < write, `${name}: role checked first`);
  }
  for (const name of ["fileInboxItem", "inboxReceiptForBill"]) {
    const start = actions.indexOf(`export async function ${name}(`);
    const next = actions.indexOf("\nexport ", start + 1);
    const body = actions.slice(start, next > 0 ? next : undefined);
    const first = body.search(/\.(update|insert|upload|copy)\(/);
    assert.ok(body.indexOf("visibleLead(") > 0 || body.indexOf("visibleJob(") > 0, `${name}: checks the job`);
    const check = Math.max(body.indexOf("visibleLead("), body.indexOf("visibleJob("));
    assert.ok(check < first, `${name}: job checked before it writes`);
  }
});

test("the inbox is in the Production menu, for the office and production by default", () => {
  const types = source("./data/types.ts");
  assert.match(types, /\{ key: "whatsapp-inbox", label: "WhatsApp Inbox", href: "\/whatsapp-inbox", group: "Production" \}/);
});

test("by default only Office, Admin and Production see the inbox in the menu", () => {
  assert.equal(defaultPageVisible("Office", "whatsapp-inbox"), true);
  assert.equal(defaultPageVisible("Production", "whatsapp-inbox"), true);
  for (const role of ["Sales", "Field", "Call Center", "Dispatch", "Bookkeeping"] as const) {
    assert.equal(defaultPageVisible(role, "whatsapp-inbox"), false, role);
  }
  assert.equal(canSeePage({ roles: ["Admin"] }, "whatsapp-inbox", []), true);
});

test("inboxCardActions: every card waiting to be sorted can at least be dismissed", () => {
  const withFile = { hasFile: true, mediaStatus: "saved" as const };
  assert.deepEqual(inboxCardActions(withFile, "to_sort", true), ["bill", "file", "dismiss"]);
  assert.deepEqual(inboxCardActions(withFile, "to_sort", false), ["file", "dismiss"]);
  // A copy that failed or was too big has nothing to file -- but it must
  // never sit in To sort forever.
  for (const mediaStatus of ["failed", "too_large", "pending", "saving"] as const) {
    assert.deepEqual(inboxCardActions({ hasFile: false, mediaStatus }, "to_sort", true), ["dismiss"], mediaStatus);
  }
  assert.deepEqual(inboxCardActions(withFile, "dismissed", true), ["restore"]);
  assert.deepEqual(inboxCardActions(withFile, "filed", true), []);
});

test("dismissing doesn't need the file to have been copied", () => {
  const actions = source("./actions/whatsapp-inbox.ts");
  const helper = actions.slice(actions.indexOf("async function inboxMessage("), actions.indexOf("export type InboxItem"));
  assert.doesNotMatch(helper, /media_path\) return null/);
  const view = source("../app/(app)/whatsapp-inbox/whatsapp-inbox-view.tsx");
  assert.match(view, /inboxCardActions\(/);
});
