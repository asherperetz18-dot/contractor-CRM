import { QB_MINOR_VERSION } from "./oauth.ts";

/**
 * Talking to a company's QuickBooks Online for step 2 (DECISIONS #173):
 * find or add a vendor, and add, change or remove the bills and bill
 * payments the CRM sent, and their receipts (DECISIONS #174). Pure, with
 * `fetch` passed in, so it's tested without the network; the caller holds
 * the login (connection.ts).
 *
 * Every write carries a request id: QuickBooks answers a repeat of the
 * same id with its first answer instead of doing the write twice. Each new
 * try gets a new one; only an add whose answer never came is repeated with
 * its own (bill-sync-run.ts keeps it), so a run cut off after QuickBooks
 * saved a bill doesn't add it again.
 */

export type QbAccess = { realmId: string; accessToken: string; apiBase: string };

export type QbErrorKind = "auth" | "throttle" | "transient" | "stale" | "notfound" | "duplicate" | "validation";
export type QbError = { kind: QbErrorKind; message: string; code: string | null };

/** One QuickBooks call may take this long; a slow one mustn't hold up every company. */
const TIMEOUT_MS = 20_000;
/** A receipt upload carries the file, so it gets longer. */
const UPLOAD_TIMEOUT_MS = 60_000;

/** What a QuickBooks error means for the next step. */
export function classifyQbError(status: number, json: unknown): QbError {
  const err = (json as { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } } | null)?.Fault?.Error?.[0];
  const code = typeof err?.code === "string" ? err.code : null;
  const said = (err?.Detail || err?.Message || "").trim();
  if (status === 401 || code === "3200") return { kind: "auth", message: "QuickBooks needs you to connect again.", code };
  if (status === 429 || code === "003001") {
    return { kind: "throttle", message: "QuickBooks asked the CRM to slow down. The rest go in a few minutes.", code };
  }
  if (status >= 500 || status === 0) {
    return { kind: "transient", message: "QuickBooks didn't answer properly. Trying again in a few minutes.", code };
  }
  if (code === "5010") return { kind: "stale", message: "It changed in QuickBooks meanwhile.", code };
  if (code === "610") return { kind: "notfound", message: said ? `QuickBooks said: ${said}` : "It's no longer in QuickBooks.", code };
  if (code === "6240") return { kind: "duplicate", message: said ? `QuickBooks said: ${said}` : "That name is already used in QuickBooks.", code };
  return { kind: "validation", message: said ? `QuickBooks said: ${said}` : `QuickBooks refused it (${status}).`, code };
}

async function call(
  access: QbAccess,
  method: "GET" | "POST",
  path: string,
  params: Record<string, string>,
  body: unknown,
  fetchImpl: typeof fetch
): Promise<{ json: Record<string, unknown> } | { error: QbError }> {
  const url = new URL(`${access.apiBase}/v3/company/${encodeURIComponent(access.realmId)}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("minorversion", String(QB_MINOR_VERSION));
  // A form (an upload) sets its own content type, with its boundary.
  const form = body instanceof FormData;
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${access.accessToken}`,
        Accept: "application/json",
        ...(body === undefined || form ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(form ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS),
    });
  } catch {
    return { error: { kind: "transient", message: "QuickBooks couldn't be reached. Trying again in a few minutes.", code: null } };
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  // Accepted, but the answer was cut off: it may well have been done, so
  // it counts as no answer, never as a refusal.
  if (res.ok && !json) {
    return { error: { kind: "transient", message: "QuickBooks' answer didn't come through. Trying again in a few minutes.", code: null } };
  }
  if (!res.ok || !json || "Fault" in json) return { error: classifyQbError(res.ok ? 400 : res.status, json) };
  return { json };
}

/** QuickBooks answered about another record than the one asked about. */
const otherRecord = (): { error: QbError } => ({
  error: { kind: "validation", message: "QuickBooks answered about a different record. Trying again later.", code: null },
});

type Saved = { id: string; syncToken: string };

function saved(json: Record<string, unknown>, entity: string): Saved | { error: QbError } {
  const e = json[entity] as { Id?: unknown; SyncToken?: unknown } | undefined;
  if (!e || typeof e.Id !== "string") {
    return { error: { kind: "transient", message: "QuickBooks didn't say what it saved. Trying again in a few minutes.", code: null } };
  }
  return { id: e.Id, syncToken: typeof e.SyncToken === "string" ? e.SyncToken : "0" };
}

/** QuickBooks' query for one vendor by its exact name (case doesn't count),
 *  inactive ones included, so an inactive vendor isn't added twice. */
export function vendorQuery(name: string): string {
  return `select * from Vendor where DisplayName = '${name.replace(/'/g, "\\'")}' and Active in (true, false)`;
}

export async function findVendor(
  access: QbAccess,
  name: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ vendor: { id: string; active: boolean } | null } | { error: QbError }> {
  const res = await call(access, "GET", "query", { query: vendorQuery(name) }, undefined, fetchImpl);
  if ("error" in res) return res;
  const rows = ((res.json.QueryResponse as { Vendor?: { Id?: unknown; Active?: unknown }[] } | undefined)?.Vendor ?? []).filter(
    (v) => typeof v.Id === "string"
  );
  // An active one first, if QuickBooks has both.
  const pick = rows.find((v) => v.Active !== false) ?? rows[0];
  return { vendor: pick ? { id: pick.Id as string, active: pick.Active !== false } : null };
}

export async function createVendor(access: QbAccess, name: string, requestId: string, fetchImpl: typeof fetch = fetch) {
  const res = await call(access, "POST", "vendor", { requestid: requestId }, { DisplayName: name }, fetchImpl);
  return "error" in res ? res : saved(res.json, "Vendor");
}

export type QbBillBody = {
  VendorRef: { value: string };
  TxnDate: string;
  DueDate?: string;
  PrivateNote: string;
  Line: {
    Id?: string;
    DetailType: "AccountBasedExpenseLineDetail";
    Amount: number;
    Description?: string;
    AccountBasedExpenseLineDetail: { AccountRef: { value: string } };
  }[];
};

export type QbBillPaymentBody = {
  VendorRef: { value: string };
  PayType: "Check" | "CreditCard";
  CheckPayment?: { BankAccountRef: { value: string }; PrintStatus: "PrintComplete" | "NotSet" };
  CreditCardPayment?: { CCAccountRef: { value: string } };
  TotalAmt: number;
  TxnDate: string;
  DocNumber?: string;
  PrivateNote?: string;
  Line: { Amount: number; LinkedTxn: { TxnId: string; TxnType: "Bill" }[] }[];
};

/** Adds a bill. `body` is a QbBillBody -- or, repeating a try whose answer
 *  never came, exactly what was sent then. */
export async function createBill(access: QbAccess, body: QbBillBody | unknown, requestId: string, fetchImpl: typeof fetch = fetch) {
  const res = await call(access, "POST", "bill", { requestid: requestId }, body, fetchImpl);
  return "error" in res ? res : saved(res.json, "Bill");
}

/** A bill as QuickBooks has it now, lines and all: what a change or a
 *  delete must name, and what a change must keep. */
export async function readBill(
  access: QbAccess,
  id: string,
  fetchImpl: typeof fetch = fetch
): Promise<(Saved & { lines: Record<string, unknown>[] }) | { error: QbError }> {
  const res = await call(access, "GET", `bill/${encodeURIComponent(id)}`, {}, undefined, fetchImpl);
  if ("error" in res) return res;
  const s = saved(res.json, "Bill");
  if ("error" in s) return s;
  const lines = ((res.json.Bill as { Line?: Record<string, unknown>[] }).Line ?? []).filter((l) => l && l.DetailType !== "SubTotalLineDetail");
  return { ...s, lines };
}

/** Changes a bill in place: a sparse body from billUpdateBody (bill-sync.ts),
 *  which keeps what the bookkeeper set on it. */
export async function updateBill(access: QbAccess, body: Record<string, unknown>, requestId: string, fetchImpl: typeof fetch = fetch) {
  const res = await call(access, "POST", "bill", { requestid: requestId }, body, fetchImpl);
  if ("error" in res) return res;
  const s = saved(res.json, "Bill");
  return "error" in s || s.id === body.Id ? s : otherRecord();
}

/** QuickBooks can't void a bill; deleting is the only way to take it back. */
export async function deleteBill(access: QbAccess, current: Saved, requestId: string, fetchImpl: typeof fetch = fetch) {
  const res = await call(
    access,
    "POST",
    "bill",
    { operation: "delete", requestid: requestId },
    { Id: current.id, SyncToken: current.syncToken },
    fetchImpl
  );
  if ("error" in res) return res;
  return (res.json.Bill as { Id?: unknown } | undefined)?.Id === current.id ? { id: current.id, syncToken: current.syncToken } : otherRecord();
}

export async function createBillPayment(
  access: QbAccess,
  body: QbBillPaymentBody | unknown,
  requestId: string,
  fetchImpl: typeof fetch = fetch
) {
  // A check number used twice (a reprinted check) shouldn't stop the payment.
  const res = await call(access, "POST", "billpayment", { requestid: requestId, include: "allowduplicatedocnum" }, body, fetchImpl);
  return "error" in res ? res : saved(res.json, "BillPayment");
}

/** A bill payment as QuickBooks has it now; voided already, or not. */
export async function readBillPayment(
  access: QbAccess,
  id: string,
  fetchImpl: typeof fetch = fetch
): Promise<(Saved & { voided: boolean }) | { error: QbError }> {
  const res = await call(access, "GET", `billpayment/${encodeURIComponent(id)}`, {}, undefined, fetchImpl);
  if ("error" in res) return res;
  const s = saved(res.json, "BillPayment");
  if ("error" in s) return s;
  const p = res.json.BillPayment as { TotalAmt?: unknown; Line?: unknown[]; PrivateNote?: unknown };
  // A voided payment is kept at zero, its lines cleared, "Voided" in its memo.
  const voided = Number(p.TotalAmt) === 0 && !(p.Line ?? []).length && /^Voided/i.test(String(p.PrivateNote ?? ""));
  return { ...s, voided };
}

/** A voided bill payment stays in QuickBooks at zero, marked Voided: the
 *  record of what happened, and its bill is owed again. */
export async function voidBillPayment(access: QbAccess, current: Saved, requestId: string, fetchImpl: typeof fetch = fetch) {
  const res = await call(
    access,
    "POST",
    "billpayment",
    { operation: "update", include: "void", requestid: requestId },
    { Id: current.id, SyncToken: current.syncToken, sparse: true },
    fetchImpl
  );
  if ("error" in res) return res;
  const s = saved(res.json, "BillPayment");
  return "error" in s || s.id === current.id ? s : otherRecord();
}

// ---------------------------------------------------------------- receipts (DECISIONS #174)

/** QuickBooks' query for the attachment the CRM uploaded with this note. */
export function attachableNoteQuery(note: string): string {
  return `select * from Attachable where Note = '${note.replace(/'/g, "\\'")}'`;
}

/**
 * Uploads a bill's receipt and attaches it to the bill in QuickBooks, as a
 * Receipt. `note` is unique to this try: if the answer is lost, the
 * attachment is found by it (findAttachableByNote) instead of being
 * uploaded twice.
 */
export async function uploadReceipt(
  access: QbAccess,
  p: { billQbId: string; fileName: string; contentType: string; note: string; bytes: Blob | Uint8Array },
  fetchImpl: typeof fetch = fetch
): Promise<Saved | { error: QbError }> {
  const form = new FormData();
  const meta = {
    AttachableRef: [{ EntityRef: { type: "Bill", value: p.billQbId } }],
    FileName: p.fileName,
    ContentType: p.contentType,
    Category: "Receipt",
    Note: p.note,
  };
  form.append("file_metadata_01", new Blob([JSON.stringify(meta)], { type: "application/json" }), "attachment.json");
  form.append("file_content_01", new File([p.bytes as BlobPart], p.fileName, { type: p.contentType }));
  const res = await call(access, "POST", "upload", {}, form, fetchImpl);
  if ("error" in res) return res;
  const item = ((res.json.AttachableResponse as { Attachable?: unknown; Fault?: unknown }[] | undefined) ?? [])[0];
  // Each file has its own answer: a refusal comes inside it.
  if (item && "Fault" in item && item.Fault) return { error: classifyQbError(400, { Fault: item.Fault }) };
  return saved({ Attachable: item?.Attachable }, "Attachable");
}

/** QuickBooks' query for the attachments on one bill. */
export function attachableBillQuery(billQbId: string): string {
  return `select * from Attachable where AttachableRef.EntityRef.Type = 'Bill' and AttachableRef.EntityRef.value = '${billQbId.replace(/'/g, "\\'")}'`;
}

/**
 * The attachment the CRM uploaded with this note, if QuickBooks has it.
 * Looked for by its note; if QuickBooks won't look by note, among the
 * bill's attachments. An error is never taken as "not there".
 */
export async function findAttachableByNote(
  access: QbAccess,
  p: { note: string; billQbId: string | null },
  fetchImpl: typeof fetch = fetch
): Promise<{ attachable: { id: string } | null } | { error: QbError }> {
  const rows = (json: Record<string, unknown>) =>
    ((json.QueryResponse as { Attachable?: { Id?: unknown; Note?: unknown }[] } | undefined)?.Attachable ?? []).filter(
      (a) => typeof a.Id === "string" && a.Note === p.note
    );
  const res = await call(access, "GET", "query", { query: attachableNoteQuery(p.note) }, undefined, fetchImpl);
  if (!("error" in res)) {
    const hit = rows(res.json)[0];
    return { attachable: hit ? { id: hit.Id as string } : null };
  }
  if (res.error.kind !== "validation" || !p.billQbId) return res;
  const onBill = await call(access, "GET", "query", { query: attachableBillQuery(p.billQbId) }, undefined, fetchImpl);
  if ("error" in onBill) return onBill;
  const hit = rows(onBill.json)[0];
  return { attachable: hit ? { id: hit.Id as string } : null };
}

/** An attachment as QuickBooks has it now: its delete must send it back whole. */
export async function readAttachable(
  access: QbAccess,
  id: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ attachable: Record<string, unknown> } | { error: QbError }> {
  const res = await call(access, "GET", `attachable/${encodeURIComponent(id)}`, {}, undefined, fetchImpl);
  if ("error" in res) return res;
  const s = saved(res.json, "Attachable");
  if ("error" in s) return s;
  return { attachable: res.json.Attachable as Record<string, unknown> };
}

/** Deletes an attachment the CRM uploaded; `current` is it as readAttachable read it. */
export async function deleteAttachable(access: QbAccess, current: Record<string, unknown>, requestId: string, fetchImpl: typeof fetch = fetch) {
  const res = await call(access, "POST", "attachable", { operation: "delete", requestid: requestId }, current, fetchImpl);
  if ("error" in res) return res;
  const id = String(current.Id);
  return (res.json.Attachable as { Id?: unknown } | undefined)?.Id === id ? { id, syncToken: String(current.SyncToken ?? "0") } : otherRecord();
}
