import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachableBillQuery,
  attachableTxnQuery,
  createPurchase,
  deletePurchase,
  findAttachableByNote,
  readPurchase,
  updatePurchase,
  uploadReceipt,
  type QbAccess,
  type QbPurchaseBody,
} from "./api.ts";

/**
 * QuickBooks, step 4 (DECISIONS #199): a lender fee goes to QuickBooks as an
 * Expense (QuickBooks calls it a Purchase), with its receipt attached the
 * way a bill's is. These are the calls; the fake `fetch` stands in for
 * QuickBooks, so nothing here goes over the network.
 */

const access: QbAccess = { realmId: "9341", accessToken: "AT", apiBase: "https://sandbox-quickbooks.api.intuit.com" };
type Seen = { url: string; init: RequestInit };

/** Answers every call with `json` (status 200 unless given), and keeps what was asked. */
function answering(json: unknown, status = 200) {
  const calls: Seen[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const fee: QbPurchaseBody = {
  PaymentType: "Cash",
  AccountRef: { value: "35" },
  EntityRef: { value: "56", type: "Vendor" },
  TxnDate: "2026-10-08",
  PrivateNote: "EST-1058 · James Carter · Basement finish",
  Line: [
    {
      DetailType: "AccountBasedExpenseLineDetail",
      Amount: 1920,
      Description: "Service Finance dealer fee on EST-1058",
      AccountBasedExpenseLineDetail: { AccountRef: { value: "62" } },
    },
  ],
};

test("an expense is added with a POST to purchase, carrying its request id, and its id comes back", async () => {
  const { calls, fetchImpl } = answering({ Purchase: { Id: "77", SyncToken: "0" } });
  const res = await createPurchase(access, fee, "crm-a", fetchImpl);
  assert.deepEqual(res, { id: "77", syncToken: "0" });
  assert.equal(calls.length, 1);
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/v3/company/9341/purchase");
  assert.equal(u.search, "?requestid=crm-a&minorversion=75");
  assert.equal(calls[0].init.method, "POST");
  assert.equal((calls[0].init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), fee);

  // An answer that's cut off is no answer, never a refusal: the same request id is tried again.
  const cut = (async () => new Response("{\"Purchase\":{\"Id\"", { status: 200 })) as unknown as typeof fetch;
  const lost = await createPurchase(access, fee, "crm-a", cut);
  assert.ok("error" in lost && lost.error.kind === "transient");
  // An answer without the expense in it isn't taken as saved.
  const empty = await createPurchase(access, fee, "crm-a", answering({ time: "now" }).fetchImpl);
  assert.ok("error" in empty && empty.error.kind === "transient");
});

test("an expense is read as QuickBooks has it: its lines (no subtotal), payee, paid-from account, payment type and date", async () => {
  const line = {
    Id: "1",
    DetailType: "AccountBasedExpenseLineDetail",
    Amount: 1920,
    AccountBasedExpenseLineDetail: { AccountRef: { value: "70" }, ClassRef: { value: "3" } },
  };
  const { calls, fetchImpl } = answering({
    Purchase: {
      Id: "77",
      SyncToken: "2",
      PaymentType: "Cash",
      AccountRef: { value: "35", name: "Checking" },
      EntityRef: { value: "56", type: "Vendor", name: "Service Finance" },
      TxnDate: "2026-10-08",
      Line: [line, { DetailType: "SubTotalLineDetail", Amount: 1920 }],
    },
  });
  const res = await readPurchase(access, "77", fetchImpl);
  assert.deepEqual(res, {
    id: "77",
    syncToken: "2",
    lines: [line],
    entityRef: { value: "56", type: "Vendor", name: "Service Finance" },
    accountRef: { value: "35", name: "Checking" },
    paymentType: "Cash",
    txnDate: "2026-10-08",
  });
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/v3/company/9341/purchase/77");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.body, undefined);

  // What QuickBooks leaves out reads as null, not as something made up.
  const bare = await readPurchase(access, "78", answering({ Purchase: { Id: "78", SyncToken: "0" } }).fetchImpl);
  assert.deepEqual(bare, { id: "78", syncToken: "0", lines: [], entityRef: null, accountRef: null, paymentType: null, txnDate: null });

  // Deleted there: QuickBooks says 610, which the job reads as gone.
  const missing = await readPurchase(
    access,
    "79",
    answering({ Fault: { Error: [{ Message: "Object Not Found", Detail: "Object Not Found : Something you're trying to use has been made inactive.", code: "610" }] } }, 400).fetchImpl
  );
  assert.ok("error" in missing && missing.error.kind === "notfound");
});

test("a change is posted as given (sparse, from the planner), and an answer about another expense isn't taken", async () => {
  const body = { Id: "77", SyncToken: "2", sparse: true, TxnDate: "2026-10-09", Line: [] };
  const ok = answering({ Purchase: { Id: "77", SyncToken: "3" } });
  assert.deepEqual(await updatePurchase(access, body, "crm-b", ok.fetchImpl), { id: "77", syncToken: "3" });
  const u = new URL(ok.calls[0].url);
  assert.equal(u.pathname, "/v3/company/9341/purchase");
  assert.equal(u.searchParams.get("requestid"), "crm-b");
  assert.equal(u.searchParams.get("operation"), null);
  assert.deepEqual(JSON.parse(String(ok.calls[0].init.body)), body);

  const other = await updatePurchase(access, body, "crm-b", answering({ Purchase: { Id: "999", SyncToken: "4" } }).fetchImpl);
  assert.ok("error" in other);
  assert.equal(other.error.kind, "validation");
  assert.equal(other.error.message, "QuickBooks answered about a different record. Trying again later.");

  // Changed there meanwhile: stale, so the job reads it again and retries.
  const stale = await updatePurchase(
    access,
    body,
    "crm-b",
    answering({ Fault: { Error: [{ Message: "Stale Object Error", Detail: "d", code: "5010" }] } }, 400).fetchImpl
  );
  assert.ok("error" in stale && stale.error.kind === "stale");
});

test("an expense is deleted with operation=delete, sending only its Id and SyncToken", async () => {
  const { calls, fetchImpl } = answering({ Purchase: { Id: "77", status: "Deleted" } });
  const res = await deletePurchase(access, { id: "77", syncToken: "3" }, "crm-c", fetchImpl);
  assert.deepEqual(res, { id: "77", syncToken: "3" });
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/v3/company/9341/purchase");
  assert.equal(u.searchParams.get("operation"), "delete");
  assert.equal(u.searchParams.get("requestid"), "crm-c");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { Id: "77", SyncToken: "3" });

  const other = await deletePurchase(access, { id: "77", syncToken: "3" }, "crm-c", answering({ Purchase: { Id: "999", status: "Deleted" } }).fetchImpl);
  assert.ok("error" in other && /different record/.test(other.error.message));
  // Books closed for its date: a refusal the job holds the delete on.
  const closed = await deletePurchase(
    access,
    { id: "77", syncToken: "3" },
    "crm-c",
    answering({ Fault: { Error: [{ Message: "Account Period Closed", Detail: "d", code: "6210" }] } }, 400).fetchImpl
  );
  assert.ok("error" in closed && closed.error.kind === "validation" && closed.error.code === "6210");
});

test("a receipt can be attached to an expense; a bill's still goes to the bill", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const meta = async (calls: Seen[]) => JSON.parse(await ((calls[0].init.body as FormData).get("file_metadata_01") as Blob).text());

  const toExpense = answering({ AttachableResponse: [{ Attachable: { Id: "5000", SyncToken: "0" } }] });
  const res = await uploadReceipt(
    access,
    { billQbId: "77", entity: "Purchase", fileName: "Receipt · Service Finance · Oct 8.pdf", contentType: "application/pdf", note: "From the CRM, ref crm-1", bytes },
    toExpense.fetchImpl
  );
  assert.deepEqual(res, { id: "5000", syncToken: "0" });
  assert.equal(new URL(toExpense.calls[0].url).pathname, "/v3/company/9341/upload");
  assert.deepEqual((await meta(toExpense.calls)).AttachableRef[0].EntityRef, { type: "Purchase", value: "77" });

  // Without `entity`: a bill, as before (receipts already in doubt were saved this way).
  const toBill = answering({ AttachableResponse: [{ Attachable: { Id: "5001", SyncToken: "0" } }] });
  await uploadReceipt(access, { billQbId: "108", fileName: "a.jpg", contentType: "image/jpeg", note: "n", bytes }, toBill.fetchImpl);
  assert.deepEqual((await meta(toBill.calls)).AttachableRef[0].EntityRef, { type: "Bill", value: "108" });
});

test("the attachments on one bill or expense are asked for by its type and id", () => {
  assert.equal(
    attachableTxnQuery("Purchase", "77"),
    "select * from Attachable where AttachableRef.EntityRef.Type = 'Purchase' and AttachableRef.EntityRef.value = '77'"
  );
  assert.equal(
    attachableTxnQuery("Bill", "5"),
    "select * from Attachable where AttachableRef.EntityRef.Type = 'Bill' and AttachableRef.EntityRef.value = '5'"
  );
  // Bills' query reads exactly as it did.
  assert.equal(
    attachableBillQuery("5"),
    "select * from Attachable where AttachableRef.EntityRef.Type = 'Bill' and AttachableRef.EntityRef.value = '5'"
  );
  // An apostrophe in an id can't end the quotes early.
  assert.equal(
    attachableTxnQuery("Purchase", "7'7"),
    "select * from Attachable where AttachableRef.EntityRef.Type = 'Purchase' and AttachableRef.EntityRef.value = '7\\'7'"
  );
});

test("a lost upload to an expense is looked for among the expense's attachments when QuickBooks won't look by note", async () => {
  const note = "From the CRM, ref crm-1";
  const refused = () => new Response(JSON.stringify({ Fault: { Error: [{ Message: "m", Detail: "QueryParserError", code: "4000" }] } }), { status: 400 });
  const queries: string[] = [];
  const fetchImpl = (async (url: string) => {
    const q = new URL(url).searchParams.get("query")!;
    queries.push(q);
    if (/Note =/.test(q)) return refused();
    return new Response(JSON.stringify({ QueryResponse: { Attachable: [{ Id: "777", Note: "bookkeeper" }, { Id: "5001", Note: note }] } }), { status: 200 });
  }) as unknown as typeof fetch;

  const found = await findAttachableByNote(access, { note, billQbId: "77", entity: "Purchase" }, fetchImpl);
  assert.deepEqual(found, { attachable: { id: "5001" } });
  assert.equal(queries.length, 2);
  assert.equal(queries[1], attachableTxnQuery("Purchase", "77"));

  // Without `entity`: a bill's attachments, as before.
  queries.length = 0;
  await findAttachableByNote(access, { note, billQbId: "108" }, fetchImpl);
  assert.equal(queries[1], attachableBillQuery("108"));
});
