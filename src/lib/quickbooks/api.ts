import { QB_MINOR_VERSION } from "./oauth.ts";

/**
 * Talking to a company's QuickBooks Online for step 2 (DECISIONS #173):
 * find or add a vendor, and add, change or remove the bills and bill
 * payments the CRM sent. Pure, with `fetch` passed in, so it's tested
 * without the network; the caller holds the login (connection.ts).
 *
 * Every write carries a request id: QuickBooks answers a repeat of the
 * same id with its first answer instead of doing the write twice, so a
 * run cut off after QuickBooks saved a bill doesn't add it again.
 */

export type QbAccess = { realmId: string; accessToken: string; apiBase: string };

export type QbErrorKind = "auth" | "throttle" | "transient" | "stale" | "notfound" | "duplicate" | "validation";
export type QbError = { kind: QbErrorKind; message: string; code: string | null };

/** One QuickBooks call may take this long; a slow one mustn't hold up every company. */
const TIMEOUT_MS = 20_000;

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
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${access.accessToken}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { error: { kind: "transient", message: "QuickBooks couldn't be reached. Trying again in a few minutes.", code: null } };
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !json || "Fault" in json) return { error: classifyQbError(res.ok ? 400 : res.status, json) };
  return { json };
}

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

export async function createBill(access: QbAccess, body: QbBillBody, requestId: string, fetchImpl: typeof fetch = fetch) {
  const res = await call(access, "POST", "bill", { requestid: requestId }, body, fetchImpl);
  return "error" in res ? res : saved(res.json, "Bill");
}

/** A bill as QuickBooks has it now: what an update or delete must name. */
export async function readBill(
  access: QbAccess,
  id: string,
  fetchImpl: typeof fetch = fetch
): Promise<(Saved & { lineId: string | null }) | { error: QbError }> {
  const res = await call(access, "GET", `bill/${encodeURIComponent(id)}`, {}, undefined, fetchImpl);
  if ("error" in res) return res;
  const s = saved(res.json, "Bill");
  if ("error" in s) return s;
  const line = ((res.json.Bill as { Line?: { Id?: unknown; DetailType?: unknown }[] }).Line ?? []).find(
    (l) => l.DetailType === "AccountBasedExpenseLineDetail" && typeof l.Id === "string"
  );
  return { ...s, lineId: (line?.Id as string | undefined) ?? null };
}

/** Changes the bill in place. Sparse: what the CRM doesn't send (a class,
 *  terms, a location the bookkeeper set) stays as it is; the one line is
 *  replaced by the CRM's. */
export async function updateBill(
  access: QbAccess,
  current: Saved & { lineId: string | null },
  body: QbBillBody,
  requestId: string,
  fetchImpl: typeof fetch = fetch
) {
  const line = { ...body.Line[0], ...(current.lineId ? { Id: current.lineId } : {}) };
  const res = await call(
    access,
    "POST",
    "bill",
    { requestid: requestId },
    { ...body, Line: [line], Id: current.id, SyncToken: current.syncToken, sparse: true },
    fetchImpl
  );
  return "error" in res ? res : saved(res.json, "Bill");
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
  return "error" in res ? res : { id: current.id, syncToken: current.syncToken };
}

export async function createBillPayment(
  access: QbAccess,
  body: QbBillPaymentBody,
  requestId: string,
  fetchImpl: typeof fetch = fetch
) {
  // A check number used twice (a reprinted check) shouldn't stop the payment.
  const res = await call(access, "POST", "billpayment", { requestid: requestId, include: "allowduplicatedocnum" }, body, fetchImpl);
  return "error" in res ? res : saved(res.json, "BillPayment");
}

export async function readBillPayment(access: QbAccess, id: string, fetchImpl: typeof fetch = fetch) {
  const res = await call(access, "GET", `billpayment/${encodeURIComponent(id)}`, {}, undefined, fetchImpl);
  return "error" in res ? res : saved(res.json, "BillPayment");
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
  return "error" in res ? res : saved(res.json, "BillPayment");
}
