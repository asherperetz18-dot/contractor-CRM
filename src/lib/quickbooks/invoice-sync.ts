import { createHash } from "node:crypto";
import { clientName } from "../data/client-name.ts";
import { splitAddress } from "../data/property-address.ts";
import { qbText, qbVendorName } from "./bill-sync.ts";
import { inQuickBooks, type RecordType, type SyncRecord } from "./bill-status.ts";

/**
 * QuickBooks, step 3 (DECISIONS #183): which bills to customers go to
 * QuickBooks as invoices, which payments, credits and refunds go with
 * them, which change or come out there, and which wait. Pure: the runner
 * (invoice-sync-run.ts) reads the rows, asks this what to do, then does
 * it, finding or adding the customer and the job as it goes.
 *
 * - A bill to a customer is an issued invoice, a billed stage of a
 *   contract or change order, or a contract's deposit (its own invoice,
 *   dated the day it was signed). A stage money landed on before it was
 *   billed goes too, dated the day the money came. It goes once its day is
 *   on or after the start date; once sent it's followed.
 * - Each signed contract is a job (a sub-customer) under its customer; a
 *   change order, and an invoice for the contract, go on that job.
 * - Payments go on their own invoice once the money has arrived; credits
 *   as a credit memo applied to the same invoice; a refund the customer
 *   doesn't owe back as a refund. A change order counts once.
 * - Bills with sales tax wait (entered by hand for now), and so does
 *   whatever is paid on them. Customers invoiced outside the CRM are left
 *   out, unless the company sends them too.
 * - Un-billed: removed there. Cancelled, or its contract voided with no
 *   money on it: voided there. An edited payment is changed there, a
 *   deleted one voided. Nothing typed in QuickBooks is ever touched.
 */

// ---------------------------------------------------------------- what the CRM has

export type SyncLead = {
  id: string;
  contactType: string | null;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  zip: string | null;
  /** Online payments off: invoiced outside the CRM (0133). */
  outside: boolean;
};

export type SyncDoc = {
  id: string;
  leadId: string;
  /** contract, change_order, invoice (others never bill). */
  kind: string | null;
  status: string;
  /** The number it goes to QuickBooks with (qbDocNumber: a revision's carries its version). */
  docNumber: string;
  /** The document's own number, the same on every version of a contract. */
  familyNumber?: string;
  title: string | null;
  /** A change order's contract, or the contract an invoice is for. */
  parentId: string | null;
  signedAt: string | null;
  issuedAt: string | null;
  taxCents: number;
  totalCents: number;
  depositCents: number;
  jobAddress: string | null;
  customerMessage: string | null;
};

export type SyncStage = {
  id: string;
  docId: string;
  sortOrder: number;
  name: string | null;
  description: string | null;
  amountCents: number;
  requestedAt: string | null;
  dueDate: string | null;
  cancelledAt: string | null;
};

/** An issued invoice's line (estimate_items). */
export type SyncLine = {
  docId: string;
  sortOrder: number;
  name: string;
  description: string | null;
  qty: number;
  unitCents: number;
  totalCents: number;
  /** Bills a job cost back (source_expense_id). */
  cost: boolean;
};

/** A portal_payments row: money in, or (negative, refundOf set) a refund. */
export type SyncMoney = {
  id: string;
  docId: string;
  stageId: string | null;
  amountCents: number;
  status: string;
  method: string | null;
  reference: string | null;
  note: string | null;
  paidAt: string | null;
  source: string | null;
  refundOf: string | null;
  stillOwed: boolean | null;
  /** A checkout the customer left: counts as nothing. */
  unfinished: boolean;
};

export type SyncCredit = {
  id: string;
  docId: string;
  stageId: string | null;
  amountCents: number;
  reason: string | null;
  createdAt: string;
  removed: boolean;
  /** The credit a refund files beside itself: never sent on its own. */
  fromRefund: boolean;
  /** That refund (a payment row), for a credit filed beside one. */
  refundId?: string | null;
};

export type SalesSettings = {
  /** QuickBooks product or service for job work: nothing goes without one. */
  jobItem: string | null;
  /** Null: the same as job work. */
  depositItem: string | null;
  costItem: string | null;
  /** Null: QuickBooks' Payments to deposit. */
  paymentsAccount: string | null;
  /** Null: QuickBooks' Payments to deposit. */
  stripeRefundsAccount: string | null;
  handRefundsAccount: string | null;
  sendOutside: boolean;
};

export type SalesPrefs = {
  customNumbers: boolean;
  autoApplyCredit: boolean;
  salesTax: boolean;
  automaticTax?: boolean;
  bookCloseDate: string | null;
};

// ---------------------------------------------------------------- what waits, and why

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDay = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return m && dd ? `${MONTHS[m - 1]} ${dd}, ${y}` : d;
};
const money$ = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const SALES_WAIT = {
  taxed: "This bill includes sales tax. The CRM doesn't send taxed bills to QuickBooks yet, so enter it there by hand.",
  taxedChild: "Its bill has sales tax, so it isn't sent. Enter this in QuickBooks by hand.",
  noItem: "No QuickBooks product or service for job work yet. Pick one in Settings › QuickBooks.",
  billFirst: "Waits for its bill to go to QuickBooks first.",
  billGone: "Its bill was deleted or voided in QuickBooks, so the CRM doesn't send it.",
  clearing: "Goes when the money clears.",
  overpaid: "This payment is more than what's left on its bill. Fix the amount, or record the extra on another stage.",
  overpaidCard:
    "This payment is more than what's left on its bill. If the customer paid twice, refund the extra in your Stripe dashboard (it shows up in the CRM by itself).",
  otherRefundOpen: 'Waits for a refund on this bill to go through, or for its "Still owed?" answer, first.',
  voidedSettling:
    "Its contract was voided in the CRM before this bill went to QuickBooks. Waits for the money on it to clear, or for its refund to be answered, before saying what to do.",
  creditByHand:
    "QuickBooks has this bill paid already (by a payment that was refunded or bounced since), so this credit can't be applied there. Enter it in QuickBooks by hand.",
  coVoidedWithMoney: "This change order was voided in the CRM, but money came in on this bill, so its QuickBooks invoice stays. Sort it out in QuickBooks.",
  coVoidedUnsent:
    "This change order was voided in the CRM before this bill went to QuickBooks, but money came in on it. Enter the bill and what was paid on it in QuickBooks by hand.",
  coVoidedUnsentChild: "Its change order was voided before the bill went to QuickBooks. Enter this there by hand, with its bill.",
  coVoidedSettling:
    "This change order was voided in the CRM before this bill went to QuickBooks. Waits for the money on it to clear, or for its refund to be answered, before saying what to do.",
  coOnVersion: (no: string) =>
    `This change order is already in QuickBooks as one bill on another version of this contract (${no}). Sending it on this version too would count it twice.`,
  coMoneyOnVersion: (no: string) =>
    `This change order is in QuickBooks as one bill on another version of this contract (${no}), so this isn't sent on this version's line. Record it in QuickBooks by hand, on that invoice.`,
  coGoesVersion: (no: string) =>
    `This change order goes to QuickBooks as one bill on another version of this contract (${no}). Sending it on this version too would count it twice.`,
  coMoneyGoesVersion: (no: string) =>
    `This change order goes to QuickBooks as one bill on another version of this contract (${no}), so this isn't sent on this version's line. Record it in QuickBooks by hand, on that invoice once it's there.`,
  coMoneyMoved:
    "This change order goes to QuickBooks on this bill now, not on its other one. Record this there by hand, and take it off the other invoice if it was put there.",
  cancelledSettling:
    "This invoice was cancelled in the CRM before it went to QuickBooks. Waits for the money on it to clear, or for its refund to be answered, before saying what to do.",
  cancelledWithMoney: "This invoice was cancelled in the CRM after money came in on it, so it stays in QuickBooks as it is, with what was paid and refunded on it.",
  cancelledUnsent:
    "This invoice was cancelled in the CRM before it went to QuickBooks, but money came in on it. Enter it and what was paid on it in QuickBooks by hand.",
  cancelledUnsentChild: "Its invoice was cancelled before it went to QuickBooks. Enter this there by hand, with its invoice.",
  noHome: "This payment isn't on a stage, and the contract has no deposit. Delete it and record it again on the stage it pays.",
  autoApply: 'QuickBooks is set to apply credits on its own, to the oldest invoice. Turn off "Automatically apply credits" in QuickBooks\' settings and it goes.',
  owedAgain: "The customer owes this money again. The CRM can't reopen a paid invoice in QuickBooks, so record it there by hand.",
  undecided: 'Waits for an answer to "Still owed?" on the refund\'s row in Payments.',
  refundOfGone: "Its payment was deleted in QuickBooks, so this refund isn't sent either. Enter it there by hand if it's needed.",
  voidedUnsent:
    "The contract was voided in the CRM before this bill went to QuickBooks, but money came in on it. Enter the bill and what was paid on it in QuickBooks by hand.",
  voidedUnsentChild: "Its bill's contract was voided before the bill went to QuickBooks. Enter this there by hand, with its bill.",
  refundOwedAgain:
    "Little or none of this refund came off the bill in the CRM, and the CRM shows money owed on the bill now. QuickBooks can't show that from here, so enter it there by hand.",
  refundBeyondBill:
    "This refund gave back money paid beyond what the bill asked (it was paid more than once, or more than its amount), so it took little or nothing off the bill. QuickBooks can't show that from here, so enter it there by hand.",
  refundOnVoided:
    "Its bill was voided or cancelled in the CRM, so this refund took nothing off it. Enter it in QuickBooks by hand, when you sort out that bill there.",
  refundedAway: "Refunded in full, so nothing goes to QuickBooks.",
  paidTwice:
    "The customer paid this bill twice and one payment was refunded. QuickBooks has one payment of that amount on the bill, which is right, so nothing more goes.",
  otherClearing: "Waits for the other payment on this bill to clear.",
  raisedPastBill:
    "This payment was raised in the CRM to more than what's left on its bill, so QuickBooks keeps its old amount. Fix the amount if it was mis-keyed; otherwise make the change in QuickBooks by hand.",
  overpaidRefunded:
    "This bill was paid more than its amount, and this payment was refunded (some or all of it), with only some of that taken off the bill. Enter it, its refund and that credit in QuickBooks by hand.",
  refundedExtra:
    "This bill was paid more than its amount, and some or all of this payment was given back. Enter it and its refund in QuickBooks by hand.",
  voidedRefunded:
    "Its bill was voided or cancelled in the CRM, and part of this payment was refunded. Enter it and its refund in QuickBooks by hand, when you sort out that bill there.",
  refundByHand: "Its payment is to be entered in QuickBooks by hand (see its line), so enter this refund there by hand with it.",
  refundedOwedAgain:
    "This payment was refunded (some or all of it) with little or none of that taken off the bill, and the CRM shows money owed on the bill now. QuickBooks can't show that from here, so enter it and its refund there by hand.",
  paidAfterRefund:
    "QuickBooks still has this bill paid by a payment that was refunded since, so this one can't go on it. Record it in QuickBooks by hand.",
  noRefundAccount: "Pick the account refunds you record by hand come from, in Settings › QuickBooks.",
  refundPending: "Goes when the refund goes through.",
  paymentFirst: "Waits for its payment to go to QuickBooks first.",
  voidedWithMoney:
    "The contract was voided in the CRM, but money came in on this bill, so its QuickBooks invoice stays. Sort it out in QuickBooks.",
  changedAfter: "It changed in the CRM after it went to QuickBooks. Change it there by hand.",
  mismatchChild: "Waits until its bill in QuickBooks matches the CRM's.",
  coOnOwn: "This change order is already in QuickBooks through its own stages. Sending it on the contract too would count it twice.",
  coOnParent: (parent: string) => `This change order is already in QuickBooks as one bill on ${parent}. Sending its stages too would count it twice.`,
  coMoneyOnOwn:
    "This change order is in QuickBooks through its own stages, so this isn't sent on the contract's line. Record it in QuickBooks by hand, on one of those invoices.",
  coMoneyOnParent: (parent: string) =>
    `This change order is in QuickBooks as one bill on ${parent}, so this isn't sent on its own stages. Record it in QuickBooks by hand, on that invoice.`,
  // Neither side has gone yet: the one billed first will.
  coGoesOwn: "This change order goes to QuickBooks through its own stages. Sending it on the contract too would count it twice.",
  coGoesParent: (parent: string) =>
    `This change order goes to QuickBooks as one bill on ${parent}. Sending its stages too would count it twice.`,
  coMoneyGoesOwn:
    "This change order goes to QuickBooks through its own stages, so this isn't sent on the contract's line. Record it in QuickBooks by hand, on one of those invoices once they're there.",
  coMoneyGoesParent: (parent: string) =>
    `This change order goes to QuickBooks as one bill on ${parent}, so this isn't sent on its own stages. Record it in QuickBooks by hand, on that invoice once it's there.`,
  negative:
    "This bill is below zero: a change order that lowers the price. The CRM doesn't send those to QuickBooks yet, so enter it there by hand as a credit.",
  paidAgain:
    "The customer paid this bill again after a refund they still owe (a bounced check, say). The CRM can't reopen a paid invoice in QuickBooks, so record the refund and this payment there by hand.",
  beforeStart: (from: string) =>
    `Paid before ${longDay(from)}, when sending to QuickBooks started, so it isn't sent. Record it in QuickBooks by hand if it isn't there yet.`,
  beforeStartRefund: "Its payment is from before sending to QuickBooks started, so this refund isn't sent either. Record it there by hand.",
  closedChange: (date: string) =>
    `QuickBooks' books are closed through ${longDay(date)}, so this change can't go there. Make it in QuickBooks by hand if it's needed, or ask whoever keeps the books to reopen that month.`,
  coGone: "This change order went to QuickBooks on its other bill, which was deleted there, so this isn't sent either. Enter it in QuickBooks by hand if it's needed.",
  coMoneyGone: "This change order went to QuickBooks on its other bill, which was deleted there, so this isn't sent either. Record it in QuickBooks by hand if it's needed.",
  closedByHand: (date: string) =>
    `QuickBooks' books are closed through ${longDay(date)}, so this isn't sent. Ask whoever keeps the books to enter it there by hand.`,
  billByHandChild: "Its bill is to be entered in QuickBooks by hand (see its line), so enter this there by hand with it.",
  undoTakenBack:
    "This was taken back in the CRM after it was to be entered in QuickBooks by hand. If it was entered there, take it out there too.",
  undoFailed: "This didn't go through after it was to be entered in QuickBooks by hand. If it was entered there, take it out there.",
  handAgain: "This was to be entered in QuickBooks by hand before, so it still is: enter it there by hand if it isn't there yet.",
  mismatch: (qbCents: number, crmCents: number) =>
    `In QuickBooks, but the total there is ${money$(qbCents)}, not ${money$(crmCents)}. QuickBooks may have added sales tax. Fix it there; its payments wait until the totals match.`,
};

/** A mismatched total is noted with this in `tried_hash`, to be looked at again. */
export const TOTAL_CHECK = "total:";

// ---------------------------------------------------------------- names, addresses, bodies

/** A name as QuickBooks takes it for a customer or job: no colon, plain letters, at most 100 long. */
export function qbCustomerName(value: string | null | undefined): string {
  return qbVendorName(value).slice(0, 100).trim();
}

export function customerName(lead: SyncLead): string {
  return qbCustomerName(
    clientName({ contact_type: lead.contactType, company_name: lead.companyName, first_name: lead.firstName, last_name: lead.lastName })
  );
}

export function jobName(doc: Pick<SyncDoc, "docNumber" | "title">): string {
  return qbCustomerName(`${doc.docNumber} ${doc.title ?? ""}`);
}

/** A free-text address as QuickBooks' address fields, split where it can be. */
export function qbAddress(text: string | null, zip: string | null = null): Record<string, string> | null {
  const raw = qbText(text, 500);
  if (!raw) return zip ? { PostalCode: zip } : null;
  const parts = splitAddress(raw);
  if (!parts) return { Line1: raw, ...(zip ? { PostalCode: zip } : {}) };
  const out: Record<string, string> = { Line1: parts.street };
  if (parts.city) out.City = parts.city;
  if (parts.state) out.CountrySubDivisionCode = parts.state;
  const postal = parts.zip ?? zip;
  if (postal) out.PostalCode = postal;
  return out;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A new QuickBooks customer for a CRM customer. Once added, the CRM never changes it. */
export function customerBody(lead: SyncLead): Record<string, unknown> {
  const company = lead.contactType === "Company" ? qbText(lead.companyName, 100) : "";
  const given = qbText(lead.firstName, 100);
  const family = qbText(lead.lastName, 100);
  const email = (lead.email ?? "").trim();
  const phone = qbText(lead.phone, 30);
  const addr = qbAddress(lead.address, (lead.zip ?? "").trim() || null);
  return {
    DisplayName: customerName(lead),
    ...(company ? { CompanyName: company } : {}),
    ...(given ? { GivenName: given } : {}),
    ...(family ? { FamilyName: family } : {}),
    ...(EMAIL.test(email) && email.length <= 100 ? { PrimaryEmailAddr: { Address: email } } : {}),
    ...(phone ? { PrimaryPhone: { FreeFormNumber: phone } } : {}),
    ...(addr ? { BillAddr: addr } : {}),
  };
}

/** A signed contract as a job (sub-customer) under its customer, billed with it. */
export function jobBody(doc: Pick<SyncDoc, "docNumber" | "title" | "jobAddress">, customerQbId: string): Record<string, unknown> {
  const ship = qbAddress(doc.jobAddress);
  return {
    DisplayName: jobName(doc),
    Job: true,
    ParentRef: { value: customerQbId },
    BillWithParent: true,
    ...(ship ? { ShipAddr: ship } : {}),
  };
}

export type InvoiceKey = { type: "invoice" | "deposit"; id: string };

export type InvoiceLineSpec = {
  item: "job" | "deposit" | "cost";
  description: string;
  qty: number | null;
  unitCents: number | null;
  amountCents: number;
};

/** A QuickBooks invoice for one CRM bill, before the customer's id is known. */
export type InvoiceSpec = {
  key: InvoiceKey;
  leadId: string;
  /** The job it goes on; null for an invoice not for a contract (on the customer). */
  contractId: string | null;
  docNumber: string | null;
  txnDay: string;
  dueDay: string;
  lines: InvoiceLineSpec[];
  amountCents: number;
  privateNote: string;
  customerMemo: string | null;
  shipTo: string | null;
};

const dollars = (cents: number) => Math.round(cents) / 100;
const NON = { TaxCodeRef: { value: "NON" } };

export function invoiceBody(
  spec: InvoiceSpec,
  ref: { customerId: string; items: { job: string; deposit: string; cost: string }; salesTax: boolean }
): Record<string, unknown> {
  const ship = qbAddress(spec.shipTo);
  return {
    CustomerRef: { value: ref.customerId },
    ...(spec.docNumber ? { DocNumber: spec.docNumber } : {}),
    TxnDate: spec.txnDay,
    DueDate: spec.dueDay,
    PrivateNote: qbText(spec.privateNote, 4000),
    ...(spec.customerMemo ? { CustomerMemo: { value: qbText(spec.customerMemo, 1000) } } : {}),
    ...(ship ? { ShipAddr: ship } : {}),
    // The CRM sends the bill itself: QuickBooks never emails it or adds a pay link.
    EmailStatus: "NotSet",
    AllowOnlineCreditCardPayment: false,
    AllowOnlineACHPayment: false,
    Line: spec.lines.map((l) => {
      // Quantity and rate only when they make the amount exactly (QuickBooks checks).
      const exact = l.qty !== null && l.unitCents !== null && Math.round(l.qty * l.unitCents) === l.amountCents && Number.isInteger(l.qty * l.unitCents);
      return {
        DetailType: "SalesItemLineDetail",
        Amount: dollars(l.amountCents),
        Description: qbText(l.description, 4000),
        SalesItemLineDetail: {
          ItemRef: { value: ref.items[l.item] },
          ...(exact ? { Qty: l.qty, UnitPrice: dollars(l.unitCents!) } : {}),
          // No sales tax the CRM didn't charge.
          ...(ref.salesTax ? NON : {}),
        },
      };
    }),
  };
}

/** QuickBooks' name for how a payment was made (found by name, or added). */
export function qbPaymentMethodName(method: string | null): string {
  switch (method) {
    case "card":
      return "Credit card";
    case "us_bank_account":
      return "Bank transfer";
    case "cash":
      return "Cash";
    case "check":
      return "Check";
    case "zelle":
      return "Zelle";
    case "wire":
      return "Wire";
    case "financing":
      return "Financing";
    default:
      return "Other";
  }
}

const memo = (note: string | null) => {
  const n = qbText(note, 3900);
  return n ? `From the CRM · ${n}` : "From the CRM";
};

export function customerPaymentBody(
  m: SyncMoney,
  ref: { customerId: string; invoiceQbId: string; methodId: string | null; depositTo: string | null; txnDay: string }
): Record<string, unknown> {
  const reference = qbText(m.reference, 21);
  return {
    CustomerRef: { value: ref.customerId },
    TotalAmt: dollars(m.amountCents),
    TxnDate: ref.txnDay,
    ...(ref.methodId ? { PaymentMethodRef: { value: ref.methodId } } : {}),
    ...(reference ? { PaymentRefNum: reference } : {}),
    ...(ref.depositTo ? { DepositToAccountRef: { value: ref.depositTo } } : {}),
    PrivateNote: memo(m.note),
    // Always linked: with no lines QuickBooks would apply it to the oldest invoice.
    Line: [{ Amount: dollars(m.amountCents), LinkedTxn: [{ TxnId: ref.invoiceQbId, TxnType: "Invoice" }] }],
  };
}

export function creditMemoBody(
  c: SyncCredit,
  ref: { customerId: string; item: string; docNumber: string; day: string; salesTax: boolean }
): Record<string, unknown> {
  const reason = qbText(c.reason, 1000);
  return {
    CustomerRef: { value: ref.customerId },
    TxnDate: ref.day,
    PrivateNote: `From the CRM · Credit on ${ref.docNumber}`,
    ...(reason ? { CustomerMemo: { value: reason } } : {}),
    Line: [
      {
        DetailType: "SalesItemLineDetail",
        Amount: dollars(c.amountCents),
        Description: qbText(reason ? `Credit on ${ref.docNumber}: ${reason}` : `Credit on ${ref.docNumber}`, 4000),
        SalesItemLineDetail: { ItemRef: { value: ref.item }, ...(ref.salesTax ? NON : {}) },
      },
    ],
  };
}

/** The $0.00 payment that applies a credit memo to its invoice: that's how QuickBooks does it. */
export function creditLinkBody(ref: { customerId: string; invoiceQbId: string; creditQbId: string; amountCents: number; day: string }): Record<string, unknown> {
  const amount = dollars(ref.amountCents);
  return {
    CustomerRef: { value: ref.customerId },
    TotalAmt: 0,
    TxnDate: ref.day,
    PrivateNote: "From the CRM · applies a credit",
    Line: [
      { Amount: amount, LinkedTxn: [{ TxnId: ref.invoiceQbId, TxnType: "Invoice" }] },
      { Amount: amount, LinkedTxn: [{ TxnId: ref.creditQbId, TxnType: "CreditMemo" }] },
    ],
  };
}

export function refundReceiptBody(
  m: SyncMoney,
  ref: { customerId: string; item: string; accountId: string; methodId: string | null; salesTax: boolean; txnDay: string }
): Record<string, unknown> {
  const reason = qbText(m.note, 1000);
  const reference = qbText(m.reference, 21);
  return {
    CustomerRef: { value: ref.customerId },
    TxnDate: ref.txnDay,
    DepositToAccountRef: { value: ref.accountId },
    ...(ref.methodId ? { PaymentMethodRef: { value: ref.methodId } } : {}),
    ...(reference ? { PaymentRefNum: reference } : {}),
    PrivateNote: "From the CRM",
    ...(reason ? { CustomerMemo: { value: reason } } : {}),
    Line: [
      {
        DetailType: "SalesItemLineDetail",
        Amount: dollars(Math.abs(m.amountCents)),
        Description: qbText(reason ? `Refund: ${reason}` : "Refund", 4000),
        SalesItemLineDetail: { ItemRef: { value: ref.item }, ...(ref.salesTax ? NON : {}) },
      },
    ],
  };
}

// ---------------------------------------------------------------- hashes

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** What QuickBooks' invoice holds: its body (amount, lines, who) and its dates, apart. */
/**
 * "body:dates:contract". The contract (its job) is kept apart: an invoice in
 * QuickBooks stays on the job it went on, and what's paid on it follows that.
 */
export function invoiceHash(spec: InvoiceSpec): string {
  const body = sha(["invoice", spec.key.type, spec.amountCents, spec.lines, spec.leadId]);
  const header = sha(["dates", spec.txnDay, spec.dueDay]);
  return `${body}:${header}:${spec.contractId ?? ""}`;
}

/** The contract an invoice went to QuickBooks on (from its hash); undefined if the hash doesn't say. */
export function sentContractOf(hash: string | null | undefined): string | null | undefined {
  const part = (hash ?? "").split(":")[2];
  return part === undefined ? undefined : part || null;
}

const keyText = (k: InvoiceKey) => `${k.type}:${k.id}`;

/** `day` is the day QuickBooks gets (the company's calendar), so a re-stamped time on the same day changes nothing. */
export function paymentHash(m: SyncMoney, key: InvoiceKey, day: string): string {
  return sha(["payment", m.amountCents, day, m.method, m.reference, m.note, keyText(key)]);
}

/**
 * The number a document goes to QuickBooks with. A contract revised and signed
 * again (it supersedes the one before) keeps its number one version up; its
 * QuickBooks numbers and job are its own (EST-1047v2-D), as the old version's
 * stay with their money. An edit before signing bumps the version too, but
 * replaces nothing: that keeps the plain number.
 */
export function qbDocNumber(d: { kind: string | null; doc_number: string; version: number | null; supersedes_id: string | null }): string {
  return d.kind === "contract" && !!d.supersedes_id && Number(d.version ?? 1) > 1 ? `${d.doc_number}v${Number(d.version)}` : d.doc_number;
}

export function creditHash(c: SyncCredit, key: InvoiceKey): string {
  return sha(["credit", c.amountCents, c.reason, keyText(key)]);
}

export function refundHash(m: SyncMoney): string {
  return sha(["refund", m.amountCents, m.method, m.reference, m.note, m.refundOf]);
}

// ---------------------------------------------------------------- the plan

export type SalesStep =
  | { op: "resolve"; record: SyncRecord }
  | { op: "create_invoice" | "update_invoice"; spec: InvoiceSpec; hash: string; record: SyncRecord | null }
  /** Its total didn't match: read it again, and settle it once it does. */
  | { op: "recheck_invoice"; spec: InvoiceSpec; record: SyncRecord }
  | { op: "void_invoice" | "delete_invoice"; recordType: "invoice" | "deposit"; recordId: string; record: SyncRecord }
  | {
      op: "create_payment" | "update_payment";
      money: SyncMoney;
      invoice: InvoiceKey;
      leadId: string;
      contractId: string | null;
      hash: string;
      record: SyncRecord | null;
    }
  | { op: "void_payment"; record: SyncRecord }
  | {
      op: "create_credit" | "link_credit";
      credit: SyncCredit;
      invoice: InvoiceKey;
      docNumber: string;
      leadId: string;
      contractId: string | null;
      hash: string;
      record: SyncRecord | null;
    }
  /** Take off a credit the CRM sent: its $0.00 link, then the credit memo. */
  | { op: "remove_credit"; recordId: string; credit: SyncRecord | null; link: SyncRecord | null; invoiceId: string | null }
  | {
      op: "create_refund";
      money: SyncMoney;
      account: "stripe" | "hand";
      leadId: string;
      contractId: string | null;
      invoiceId: string;
      hash: string;
      record: SyncRecord | null;
    }
  | { op: "delete_refund"; record: SyncRecord }
  /** Bills on a job get it in QuickBooks (step 2's lines are tagged to it). */
  | { op: "ensure_customer"; leadId: string }
  | { op: "ensure_job"; contractId: string; leadId: string }
  | { op: "wait"; recordType: RecordType; recordId: string; billId: string | null; reason: string; hash: string }
  | { op: "drop"; recordType: RecordType; recordId: string }
  /** Needs nothing in QuickBooks (a payment that came in and went back out): noted as such, so it isn't shown as going. */
  | { op: "unneeded"; recordType: RecordType; recordId: string; billId: string; reason: string }
  | { op: "settle"; recordType: RecordType; recordId: string };

const SALES_TYPES = new Set<RecordType>(["customer", "job", "invoice", "deposit", "customer_payment", "credit", "credit_link", "refund"]);

/** What a bill's state means for what's paid, credited and refunded on it. */
type BillState =
  | { kind: "go" } // in QuickBooks, or going this run
  | { kind: "skip" } // never goes (before the start date, left out): neither does anything on it
  | { kind: "wait"; reason: string }; // its things wait with this reason

// Told to be entered in QuickBooks by hand: once a record says so, it stays so -- it may be there that way, so the
// CRM never sends it, drops it or calls it done later (DECISIONS #183). By the record's own words.
const opening = (f: (x: string) => string) => f("\u0000").split("\u0000")[0];
const HAND_OPENINGS = [opening(SALES_WAIT.closedByHand), opening(SALES_WAIT.coMoneyOnParent), opening(SALES_WAIT.coMoneyGoesParent)];
const CHILD_HAND = [
  SALES_WAIT.taxedChild,
  SALES_WAIT.voidedUnsentChild,
  SALES_WAIT.cancelledUnsentChild,
  SALES_WAIT.coVoidedUnsentChild,
  SALES_WAIT.coMoneyMoved,
  SALES_WAIT.coMoneyOnOwn,
  SALES_WAIT.coMoneyGoesOwn,
  SALES_WAIT.coMoneyGone,
  SALES_WAIT.billByHandChild,
];
const HAND_WORDS: Record<"bill" | "customer_payment" | "refund" | "credit", { exact: Set<string>; openings: string[] }> = {
  bill: {
    exact: new Set([
      SALES_WAIT.taxed,
      SALES_WAIT.voidedUnsent,
      SALES_WAIT.cancelledUnsent,
      SALES_WAIT.coVoidedUnsent,
      SALES_WAIT.negative,
      SALES_WAIT.coGone,
      SALES_WAIT.handAgain,
    ]),
    openings: [opening(SALES_WAIT.closedByHand)],
  },
  customer_payment: {
    exact: new Set([
      SALES_WAIT.refundedExtra,
      SALES_WAIT.refundedOwedAgain,
      SALES_WAIT.overpaidRefunded,
      SALES_WAIT.voidedRefunded,
      SALES_WAIT.paidAfterRefund,
      SALES_WAIT.paidAgain,
      ...CHILD_HAND,
    ]),
    openings: [...HAND_OPENINGS, opening(SALES_WAIT.beforeStart)],
  },
  refund: {
    exact: new Set([
      SALES_WAIT.owedAgain,
      SALES_WAIT.refundOwedAgain,
      SALES_WAIT.refundBeyondBill,
      SALES_WAIT.refundOnVoided,
      SALES_WAIT.refundByHand,
      SALES_WAIT.refundOfGone,
      SALES_WAIT.beforeStartRefund,
      ...CHILD_HAND,
    ]),
    openings: HAND_OPENINGS,
  },
  credit: { exact: new Set([...CHILD_HAND, SALES_WAIT.creditByHand]), openings: HAND_OPENINGS },
};
/** Added to a by-hand note when what it's about changes in the CRM afterwards (it stays by hand). */
export const CHANGED_SINCE = " It changed in the CRM since: make the same change there by hand.";
const baseReason = (reason: string) => (reason.endsWith(CHANGED_SINCE) ? reason.slice(0, -CHANGED_SINCE.length) : reason);

/** Told to take it out of QuickBooks, if it went in there by hand: that stays too. */
const toldUndo = (r: SyncRecord | null) =>
  !!r && r.status === "waiting" && !inQuickBooks(r) && (r.reason === SALES_WAIT.undoTakenBack || r.reason === SALES_WAIT.undoFailed);
const toldHand = (kind: keyof typeof HAND_WORDS, r: SyncRecord | null) =>
  !!r &&
  r.status === "waiting" &&
  !inQuickBooks(r) &&
  !!r.reason &&
  (HAND_WORDS[kind].exact.has(baseReason(r.reason)) || HAND_WORDS[kind].openings.some((o) => r.reason!.startsWith(o)));
/** What a bill told to be entered by hand says to what's on it. */
const HAND_CHILD: Record<string, string> = {
  [SALES_WAIT.taxed]: SALES_WAIT.taxedChild,
  [SALES_WAIT.voidedUnsent]: SALES_WAIT.voidedUnsentChild,
  [SALES_WAIT.cancelledUnsent]: SALES_WAIT.cancelledUnsentChild,
  [SALES_WAIT.coVoidedUnsent]: SALES_WAIT.coVoidedUnsentChild,
  [SALES_WAIT.coGone]: SALES_WAIT.coMoneyGone,
};
const handChildOf = (reason: string) => HAND_CHILD[baseReason(reason)] ?? SALES_WAIT.billByHandChild;
/** Which side of a change order a note sends money to: its own stages, the contract's line, or neither. */
const coSide = (reason: string | null | undefined) => {
  const base = baseReason(reason ?? "");
  if (base === SALES_WAIT.coMoneyOnOwn || base === SALES_WAIT.coMoneyGoesOwn) return "own";
  if (base.startsWith(opening(SALES_WAIT.coMoneyOnParent)) || base.startsWith(opening(SALES_WAIT.coMoneyGoesParent))) return "parent";
  return null;
};
/** Change-order money told to go on the other side, whose own bill now goes (or is sent the other way): moved. */
const coMoved = (reason: string | null | undefined, st: { kind: string; reason?: string } | undefined) => {
  const side = coSide(reason);
  if (!side || !st) return false;
  if (st.kind === "go") return true;
  if (st.kind !== "wait" || st.reason === SALES_WAIT.billGone) return false;
  // Blocked the other way, or not blocked at all now (its own bill told by hand, or waiting to go).
  return coSide(st.reason) !== side;
};

export function planSalesSync(p: {
  leads: SyncLead[];
  docs: SyncDoc[];
  stages: SyncStage[];
  lines: SyncLine[];
  money: SyncMoney[];
  credits: SyncCredit[];
  /** This company's records for the connected QuickBooks company (bills' too: ignored). */
  records: SyncRecord[];
  sendFrom: string;
  now: Date;
  /** An instant as the company's calendar day. */
  day: (iso: string) => string;
  settings: SalesSettings;
  prefs: SalesPrefs;
  force?: boolean;
  /** Bills to tag: each one's customer and (null when it can't be told) contract. */
  billLinks: { leadId: string; contractId: string | null }[];
}): SalesStep[] {
  const force = !!p.force;
  const now = p.now.getTime();
  const k = (t: RecordType, id: string) => `${t}:${id}`;
  const records = p.records.filter((r) => SALES_TYPES.has(r.record_type));
  const recordOf = new Map(records.map((r) => [k(r.record_type, r.record_id), r]));
  const get = (t: RecordType, id: string) => recordOf.get(k(t, id)) ?? null;

  const resolves: SalesStep[] = [];
  const voids: SalesStep[] = [];
  const removals: SalesStep[] = [];
  const drops: SalesStep[] = [];
  const ensures: SalesStep[] = [];
  const work: SalesStep[] = [];
  const paymentChanges: SalesStep[] = [];

  // Anything whose add got no answer: repeated first, nothing else done to it this run.
  const busy = new Set<string>();
  for (const r of records) {
    if (!r.doubt) continue;
    busy.add(k(r.record_type, r.record_id));
    resolves.push({ op: "resolve", record: r });
  }
  const isBusy = (r: SyncRecord | null) => !!r && busy.has(k(r.record_type, r.record_id));
  const resting = (r: SyncRecord | null, hash: string) =>
    !force && !!r && (r.status === "failed" || r.status === "waiting") && r.tried_hash === hash && !!r.next_try_at && new Date(r.next_try_at).getTime() > now;
  const removalResting = (r: SyncRecord | null) =>
    !force && !!r && r.status === "failed" && r.failed_op === "remove" && !!r.next_try_at && new Date(r.next_try_at).getTime() > now;
  const drop = (r: SyncRecord | null) => {
    if (r && !isBusy(r) && !inQuickBooks(r) && r.status !== "removed" && r.status !== "gone") {
      drops.push({ op: "drop", recordType: r.record_type, recordId: r.record_id });
    }
  };
  const wait = (recordType: RecordType, recordId: string, billId: string | null, reason: string, hash: string) => {
    const r = get(recordType, recordId);
    if (r && r.status === "waiting" && r.reason === reason) return;
    work.push({ op: "wait", recordType, recordId, billId, reason, hash });
  };
  const closed = (d: string) => !!p.prefs.bookCloseDate && d <= p.prefs.bookCloseDate;
  const leadById = new Map(p.leads.map((l) => [l.id, l]));
  const leftOut = (leadId: string) => !!leadById.get(leadId)?.outside && !p.settings.sendOutside;

  const docById = new Map(p.docs.map((d) => [d.id, d]));
  // A bill still in the CRM (a stage, or a contract for its deposit). A contact deleted takes its bills with it:
  // what went to QuickBooks for them is left as it is there, never half taken out.
  const stageIds = new Set(p.stages.map((s) => s.id));
  const billInCrm = (id: string | null) => !!id && (stageIds.has(id) || docById.has(id));
  const stagesOf = new Map<string, SyncStage[]>();
  for (const s of p.stages) stagesOf.set(s.docId, [...(stagesOf.get(s.docId) ?? []), s]);
  for (const list of stagesOf.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const linesOf = new Map<string, SyncLine[]>();
  for (const l of p.lines) linesOf.set(l.docId, [...(linesOf.get(l.docId) ?? []), l]);
  for (const list of linesOf.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);

  const payments = p.money.filter((m) => !m.refundOf && m.amountCents > 0);
  const refunds = p.money.filter((m) => !!m.refundOf && m.amountCents < 0);
  const moneyById = new Map(p.money.map((m) => [m.id, m]));
  const paidDay = (m: SyncMoney) => p.day(m.paidAt ?? "") || "";
  // Refunds not owed, and what the CRM took off the bill with each (the credit it filed beside it).
  const refundsOf = (m: SyncMoney) => refunds.filter((r) => r.refundOf === m.id && r.status === "succeeded" && r.stillOwed === false);
  const filedFor = (r: SyncMoney) => p.credits.filter((c) => c.refundId === r.id && !c.removed).reduce((t, c) => t + c.amountCents, 0);
  /** Its refunds answered either way (a bounce, a deposit's), in cents (below zero). */
  const answeredBack = (m: SyncMoney) => refunds.filter((r) => r.refundOf === m.id && r.status === "succeeded" && r.stillOwed !== null);
  /** Refunded in full (not owed), nothing taken off the bill. */
  const refundedInFull = (m: SyncMoney) => {
    const back = refundsOf(m);
    return back.length > 0 && back.reduce((t, r) => t - r.amountCents, 0) >= m.amountCents && back.every((r) => filedFor(r) === 0);
  };
  /** Came in and went straight back out: refunds answered either way cover it, nothing taken off the bill.
   *  Never sent, it needs nothing in QuickBooks. */
  const cameAndWent = (m: SyncMoney) => {
    const back = answeredBack(m);
    return back.length > 0 && back.reduce((t, r) => t - r.amountCents, 0) >= m.amountCents && back.every((r) => filedFor(r) === 0);
  };
  // Money on a stage: what came in and went straight back out, never sent, doesn't make it a bill.
  const settledOn = (stageId: string) =>
    payments.filter(
      (m) => m.stageId === stageId && m.status === "succeeded" && !(cameAndWent(m) && !inQuickBooks(get("customer_payment", m.id)))
    );

  /** The invoice a payment lands on: its stage's, the deposit's, or none. */
  const homeOf = (m: SyncMoney): InvoiceKey | null => {
    if (m.stageId) return { type: "invoice", id: m.stageId };
    const d = docById.get(m.docId);
    if (!d) return null;
    if (d.kind === "invoice") {
      const only = stagesOf.get(d.id)?.[0];
      return only ? { type: "invoice", id: only.id } : null;
    }
    return d.depositCents > 0 ? { type: "deposit", id: d.id } : null;
  };

  const contractOf = (d: SyncDoc): string | null => (d.kind === "contract" ? d.id : d.parentId);
  /** A change order's or invoice's contract, voided since (revised): its signed revision, else none (the customer). */
  const liveContractOf = (d: SyncDoc): string | null => {
    const id = contractOf(d);
    const c = id ? docById.get(id) : undefined;
    if (d.kind === "contract" || !c || c.status === "Signed") return id;
    return p.docs.find((x) => x.kind === "contract" && x.status === "Signed" && x.leadId === c.leadId && (x.familyNumber ?? x.docNumber) === (c.familyNumber ?? c.docNumber))?.id ?? null;
  };

  // ------------------------------------------------ change orders count once
  // The side of a change order that waits: its own reason, and its money's.
  const coBlock = new Map<string, { reason: string; child: string }>();
  const mirrorCo = new Map<string, SyncDoc>();
  const billedOrPaid = (s: SyncStage) => (!!s.requestedAt && !s.cancelledAt) || settledOn(s.id).length > 0;
  const firstDay = (s: SyncStage) => (s.requestedAt ? p.day(s.requestedAt) : settledOn(s.id).map(paidDay).sort()[0] ?? "9999");
  const heldInQb = (s: SyncStage) => {
    const r = get("invoice", s.id);
    return inQuickBooks(r) || isBusy(r) || r?.status === "gone";
  };
  // The side that went was deleted in QuickBooks since: the other side still waits, saying so.
  const goneInQb = (s: SyncStage) => get("invoice", s.id)?.status === "gone";
  const coGone = { reason: SALES_WAIT.coGone, child: SALES_WAIT.coMoneyGone };
  const familyOf = (d: SyncDoc) => d.familyNumber ?? d.docNumber;
  const onOwn = { reason: SALES_WAIT.coOnOwn, child: SALES_WAIT.coMoneyOnOwn };
  const onParent = (no: string) => ({ reason: SALES_WAIT.coOnParent(no), child: SALES_WAIT.coMoneyOnParent(no) });
  const goesOwn = { reason: SALES_WAIT.coGoesOwn, child: SALES_WAIT.coMoneyGoesOwn };
  const goesParent = (no: string) => ({ reason: SALES_WAIT.coGoesParent(no), child: SALES_WAIT.coMoneyGoesParent(no) });
  // Another version's copy of the contract's line: called that.
  const onVersion = (no: string) => ({ reason: SALES_WAIT.coOnVersion(no), child: SALES_WAIT.coMoneyOnVersion(no) });
  const goesVersion = (no: string) => ({ reason: SALES_WAIT.coGoesVersion(no), child: SALES_WAIT.coMoneyGoesVersion(no) });
  for (const co of p.docs) {
    if (co.kind !== "change_order" || !co.parentId) continue;
    const parent = docById.get(co.parentId);
    // Its line on the contract -- and on every version of that contract, since a revision copies it.
    const versions = parent ? p.docs.filter((d) => d.kind === "contract" && d.leadId === parent.leadId && familyOf(d) === familyOf(parent)) : [];
    const mirrors = versions.flatMap((c) => (stagesOf.get(c.id) ?? []).filter((s) => (s.name ?? "").trim() === co.docNumber));
    if (!mirrors.length) continue;
    for (const m of mirrors) mirrorCo.set(m.id, co);
    const ownAll = stagesOf.get(co.id) ?? [];
    // Only a side that can still go competes for "billed first": not a voided change order's stages, nor a voided version's line.
    const own = co.status === "Signed" ? ownAll.filter(billedOrPaid) : [];
    const numberOf = (m: SyncStage) => docById.get(m.docId)?.docNumber ?? parent?.docNumber ?? "the contract";
    // A voided change order's stages can't go, but money on them still belongs to the side that does.
    const voidedOwn = co.status === "Signed" ? [] : ownAll.filter((x) => billedOrPaid(x) || !!get("invoice", x.id));
    const ownHeld = ownAll.filter(heldInQb);
    const mirrorHeld = mirrors.filter(heldInQb);
    if (ownHeld.length) {
      // Any of its own stages still in QuickBooks (an un-billed one too, until it's really gone): every contract line waits.
      const block = ownHeld.some((x) => !goneInQb(x)) ? onOwn : coGone;
      for (const m of mirrors) coBlock.set(m.id, block);
    } else if (mirrorHeld.length) {
      // One contract line is in QuickBooks: its own stages, and any other version's copy, wait.
      const kept = mirrorHeld.find((m) => !goneInQb(m));
      const block = kept ? onParent(numberOf(kept)) : coGone;
      for (const x of [...own, ...voidedOwn]) coBlock.set(x.id, block);
      for (const m of mirrors) if (!heldInQb(m)) coBlock.set(m.id, kept ? onVersion(numberOf(kept)) : block);
    } else if (ownAll.some((x) => toldHand("bill", get("invoice", x.id)))) {
      // A side told to be entered by hand goes that way: the other side waits (never told by hand too).
      for (const m of mirrors) if (!toldHand("bill", get("invoice", m.id))) coBlock.set(m.id, goesOwn);
    } else if (mirrors.some((m) => toldHand("bill", get("invoice", m.id)))) {
      const told = mirrors.find((m) => toldHand("bill", get("invoice", m.id)))!;
      const block = goesParent(numberOf(told));
      for (const x of [...own, ...voidedOwn]) coBlock.set(x.id, block);
      for (const m of mirrors) if (!toldHand("bill", get("invoice", m.id))) coBlock.set(m.id, goesVersion(numberOf(told)));
    } else {
      // Neither has gone yet: whichever was billed first will; the rest wait.
      const live = mirrors.filter((m) => billedOrPaid(m) && docById.get(m.docId)?.status === "Signed");
      // A voided version's billed line can't go, but its money still belongs to the side that does.
      const dead = mirrors.filter((m) => billedOrPaid(m) && docById.get(m.docId)?.status !== "Signed");
      const sides = [...own.map((x) => ({ x, own: true })), ...live.map((x) => ({ x, own: false }))].sort(
        (a, b) => firstDay(a.x).localeCompare(firstDay(b.x)) || Number(b.own) - Number(a.own)
      );
      if (!sides.length || (sides.length < 2 && !dead.length && !(voidedOwn.length && !sides[0].own))) continue;
      if (sides[0].own) for (const m of [...live, ...dead]) coBlock.set(m.id, goesOwn);
      else {
        const block = goesParent(numberOf(sides[0].x));
        for (const x of [...own, ...voidedOwn]) coBlock.set(x.id, block);
        for (const m of [...live, ...dead]) if (m.id !== sides[0].x.id) coBlock.set(m.id, goesVersion(numberOf(sides[0].x)));
      }
    }
  }

  // ------------------------------------------------ the bills
  const state = new Map<string, BillState>();
  const going = new Set<string>(); // invoices added or kept this run
  const blockedRemoval = new Set<string>();
  // Bills being taken out of QuickBooks: only the removal touches their credits.
  const removing = new Set<string>();
  // Bills with a payment still in QuickBooks that it wouldn't void (resting) or may be voiding (in doubt): not taken out yet.
  const paymentHeld = new Set(
    records
      .filter((r) => r.record_type === "customer_payment" && !!r.bill_id && inQuickBooks(r) && (isBusy(r) || removalResting(r)))
      .map((r) => r.bill_id!)
  );
  const leadOfKey = new Map<string, { leadId: string; contractId: string | null; docNumber: string; amountCents: number }>();

  const creditsOn = (key: InvoiceKey) => (key.type === "invoice" ? p.credits.filter((c) => c.stageId === key.id && !c.fromRefund) : []);

  /** Credits the CRM sent on a bill come off before the bill does. */
  const removeCreditsOf = (key: InvoiceKey) => {
    for (const c of creditsOn(key)) {
      const cr = get("credit", c.id);
      const lr = get("credit_link", c.id);
      if (!inQuickBooks(cr) && !inQuickBooks(lr)) continue;
      if (isBusy(cr) || isBusy(lr) || removalResting(cr) || removalResting(lr)) {
        blockedRemoval.add(key.id);
        continue;
      }
      voids.push({ op: "remove_credit", recordId: c.id, credit: inQuickBooks(cr) ? cr : null, link: inQuickBooks(lr) ? lr : null, invoiceId: key.id });
    }
  };

  // Bills that shouldn't be in QuickBooks (voided or cancelled in the CRM): nothing is owed on them.
  const notOwed = new Set<string>();

  /** `label` names the bill as the CRM does ("INV-1004", "EST-1047 Rough-in"), for a credit's words. */
  /** `cancelled`: an invoice cancelled in the CRM (its own words, never "the contract was voided"). */
  const consider = (spec: InvoiceSpec, should: boolean, voidedDoc: boolean, taxed: boolean, label: string, cancelled = false, voidedCo = false) => {
    const voidWords = cancelled
      ? { withMoney: SALES_WAIT.cancelledWithMoney, unsent: SALES_WAIT.cancelledUnsent, child: SALES_WAIT.cancelledUnsentChild, settling: SALES_WAIT.cancelledSettling }
      : voidedCo
        ? { withMoney: SALES_WAIT.coVoidedWithMoney, unsent: SALES_WAIT.coVoidedUnsent, child: SALES_WAIT.coVoidedUnsentChild, settling: SALES_WAIT.coVoidedSettling }
        : { withMoney: SALES_WAIT.voidedWithMoney, unsent: SALES_WAIT.voidedUnsent, child: SALES_WAIT.voidedUnsentChild, settling: SALES_WAIT.voidedSettling };
    const key = spec.key;
    const id = keyText(key);
    leadOfKey.set(id, { leadId: spec.leadId, contractId: spec.contractId, docNumber: label, amountCents: spec.amountCents });
    const r = get(key.type, key.id);
    if (isBusy(r)) return state.set(id, { kind: "wait", reason: SALES_WAIT.billFirst });
    if (r?.status === "gone") return state.set(id, { kind: "wait", reason: SALES_WAIT.billGone });
    const tracked = inQuickBooks(r);
    const hash = invoiceHash(spec);

    // Told to be entered by hand: so it stays, with what's on it. Taken back in the CRM with no money on it: say to
    // take it out of QuickBooks if it went in.
    if (toldHand("bill", r) || toldUndo(r)) {
      if (!should) notOwed.add(id);
      // A voided bill keeps its money on the voided version, refunded or not, so one that had any stays by hand with
      // it; a stage un-billed whose money only came in and went back out (never sent) is taken back.
      const anyMoney = payments.some(
        (m) =>
          homeMatches(m, key) &&
          (m.status === "succeeded" || (m.status === "pending" && !m.unfinished)) &&
          (voidedDoc || !(cameAndWent(m) && !inQuickBooks(get("customer_payment", m.id))))
      );
      if (!should && !anyMoney) {
        // What's on it says so too (it went in with it, if it did).
        wait(key.type, key.id, key.id, SALES_WAIT.undoTakenBack, hash);
        return state.set(id, { kind: "wait", reason: SALES_WAIT.undoTakenBack });
      }
      // Billed again after it was said to take it out, while its change order goes the other way: waits that way.
      // (Its "take it out" note stays: it may still be there.)
      const block = toldUndo(r) && key.type === "invoice" ? coBlock.get(key.id) : undefined;
      if (block) return state.set(id, { kind: "wait", reason: block.child });
      // Billed again (or money came) after it was said to take it out: still by hand (it may still be there).
      if (toldUndo(r)) wait(key.type, key.id, key.id, SALES_WAIT.handAgain, hash);
      // Changed in the CRM since it was told (its lines or dates): make the same change there.
      const sameAs = (h: string) => h.split(":").slice(0, 2).join(":");
      if (should && !toldUndo(r) && r!.tried_hash && sameAs(r!.tried_hash) !== sameAs(hash)) {
        work.push({ op: "wait", recordType: key.type, recordId: key.id, billId: key.id, reason: baseReason(r!.reason!) + CHANGED_SINCE, hash });
      }
      return state.set(id, { kind: "wait", reason: toldUndo(r) ? SALES_WAIT.billByHandChild : handChildOf(r!.reason!) });
    }

    if (!should) {
      notOwed.add(id);
      if (!tracked) {
        // Voided before it went, but money came in on it (it stays on the voided version): said, never dropped silently.
        // Even when the bill went once and was taken back (un-billed): money that came in and went straight back out aside.
        const live = payments.filter(
          (m) => homeMatches(m, key) && (m.status === "succeeded" || (m.status === "pending" && !m.unfinished)) && !cameAndWent(m)
        );
        if (voidedDoc && live.length > 0 && spec.txnDay >= p.sendFrom && !leftOut(spec.leadId)) {
          // One side of a change order whose other side went (or will): counted once still says where its money goes.
          const block = key.type === "invoice" ? coBlock.get(key.id) : undefined;
          // Money still clearing, or a refund on it not settled: not told by hand until it is (it may come and go).
          if (!block && (live.some((m) => m.status === "pending") || openRefundOn(key))) {
            const settling = voidWords.settling;
            wait(key.type, key.id, key.id, settling, hash);
            return state.set(id, { kind: "wait", reason: settling });
          }
          wait(key.type, key.id, key.id, block?.reason ?? voidWords.unsent, hash);
          return state.set(id, { kind: "wait", reason: block?.child ?? voidWords.child });
        }
        drop(r);
        return state.set(id, { kind: "skip" });
      }
      state.set(id, { kind: "go" });
      if (voidedDoc) {
        // Money on it (or a credit in QuickBooks): voiding would leave the payments as loose credit there.
        // Money that came in and went straight back out, never sent, isn't.
        const money = payments.some(
          (m) =>
            homeMatches(m, key) &&
            (m.status === "succeeded" || m.status === "pending") &&
            !(cameAndWent(m) && !inQuickBooks(get("customer_payment", m.id)))
        );
        if (money) return wait(key.type, key.id, key.id, voidWords.withMoney, hash);
      }
      removing.add(id);
      removeCreditsOf(key);
      if (blockedRemoval.has(key.id) || paymentHeld.has(key.id) || removalResting(r)) return;
      removals.push({ op: voidedDoc || key.type === "deposit" ? "void_invoice" : "delete_invoice", recordType: key.type, recordId: key.id, record: r! });
      return;
    }

    if (!tracked) {
      if (leftOut(spec.leadId) || spec.txnDay < p.sendFrom) {
        drop(r);
        return state.set(id, { kind: "skip" });
      }
      // A change order counts once first: only the side that goes is ever told to be entered by hand.
      const block = key.type === "invoice" ? coBlock.get(key.id) : undefined;
      if (block) {
        wait(key.type, key.id, key.id, block.reason, hash);
        return state.set(id, { kind: "wait", reason: block.child });
      }
      if (spec.amountCents < 0) {
        wait(key.type, key.id, key.id, SALES_WAIT.negative, hash);
        return state.set(id, { kind: "wait", reason: SALES_WAIT.billByHandChild });
      }
      if (taxed) {
        wait(key.type, key.id, key.id, SALES_WAIT.taxed, hash);
        return state.set(id, { kind: "wait", reason: SALES_WAIT.taxedChild });
      }
      if (closed(spec.txnDay)) {
        wait(key.type, key.id, key.id, SALES_WAIT.closedByHand(p.prefs.bookCloseDate!), hash);
        return state.set(id, { kind: "wait", reason: SALES_WAIT.billByHandChild });
      }
      if (!p.settings.jobItem) {
        wait(key.type, key.id, key.id, SALES_WAIT.noItem, hash);
        return state.set(id, { kind: "wait", reason: SALES_WAIT.billFirst });
      }
      if (resting(r, hash)) return state.set(id, { kind: "wait", reason: SALES_WAIT.billFirst });
      work.push({ op: "create_invoice", spec, hash, record: r });
      going.add(id);
      return state.set(id, { kind: "go" });
    }

    // In QuickBooks: is it still what the CRM has?
    if (r!.status === "waiting" && (r!.tried_hash ?? "").startsWith(TOTAL_CHECK)) {
      if (!r!.next_try_at || force || new Date(r!.next_try_at).getTime() <= now) work.push({ op: "recheck_invoice", spec, record: r! });
      return state.set(id, { kind: "wait", reason: SALES_WAIT.mismatchChild });
    }
    const [body, dates] = (r!.qb_hash ?? ":").split(":");
    const [nBody, nDates] = hash.split(":");
    if (body !== nBody) {
      wait(key.type, key.id, key.id, SALES_WAIT.changedAfter, hash);
      return state.set(id, { kind: "wait", reason: SALES_WAIT.mismatchChild });
    }
    if (dates !== nDates) {
      if (closed(spec.txnDay)) wait(key.type, key.id, key.id, SALES_WAIT.closedChange(p.prefs.bookCloseDate!), hash);
      else if (!resting(r, hash)) work.push({ op: "update_invoice", spec, hash, record: r });
    } else if (r!.status !== "sent") {
      work.push({ op: "settle", recordType: key.type, recordId: key.id });
    }
    going.add(id);
    return state.set(id, { kind: "go" });
  };

  const homeMatches = (m: SyncMoney, key: InvoiceKey) => {
    const h = homeOf(m);
    return !!h && h.type === key.type && h.id === key.id;
  };
  // A refund still going through, or not answered yet: nothing on its bill is told by hand until it settles.
  const openRefund = (r: SyncMoney) => r.status === "pending" || (r.status === "succeeded" && r.stillOwed === null);
  const openRefundOn = (key: InvoiceKey, except?: string) =>
    refunds.some((r) => {
      const original = r.id !== except && openRefund(r) ? moneyById.get(r.refundOf!) : undefined;
      return !!original && homeMatches(original, key);
    });

  for (const d of p.docs) {
    if (d.kind !== "contract" && d.kind !== "change_order" && d.kind !== "invoice") continue;
    if (d.status !== "Signed" && d.status !== "Void") continue;
    const contractId = contractOf(d);
    const voided = d.status === "Void";
    const parent = d.parentId ? docById.get(d.parentId) : undefined;

    // The deposit, as its own invoice.
    if (d.kind !== "invoice" && d.depositCents > 0 && (d.signedAt || get("deposit", d.id))) {
      const txnDay = p.day(d.signedAt ?? "") || p.sendFrom;
      const spec: InvoiceSpec = {
        key: { type: "deposit", id: d.id },
        leadId: d.leadId,
        contractId,
        docNumber: p.prefs.customNumbers ? docNo(`${d.docNumber}-D`) : null,
        txnDay,
        dueDay: txnDay,
        lines: [{ item: "deposit", description: `Deposit, ${d.docNumber}${d.title ? ` ${d.title}` : ""}`, qty: null, unitCents: null, amountCents: d.depositCents }],
        amountCents: d.depositCents,
        privateNote: `From the CRM · ${d.docNumber} · Deposit`,
        customerMemo: null,
        shipTo: d.jobAddress ?? parent?.jobAddress ?? null,
      };
      consider(spec, !voided, voided, d.taxCents > 0, `${d.docNumber} deposit`, false, d.kind === "change_order" && voided);
    }

    const stages = stagesOf.get(d.id) ?? [];
    stages.forEach((s, i) => {
      const billed = !!s.requestedAt && !s.cancelledAt;
      const settled = settledOn(s.id);
      const isInvoice = d.kind === "invoice";
      const exists = isInvoice ? billed || !!d.issuedAt : billed || settled.length > 0;
      const tracked = !!get("invoice", s.id);
      if (!exists && !tracked) return;
      // Cancelled and never sent: nothing -- unless it's on a voided contract with money on it (paid before it was billed).
      const moneyHere = payments.some((m) => m.stageId === s.id && (m.status === "succeeded" || m.status === "pending"));
      if (s.cancelledAt && !tracked && !(voided && moneyHere)) return;
      const firstMoney = settled.map(paidDay).filter(Boolean).sort()[0] ?? null;
      const txnDay = isInvoice
        ? p.day(d.issuedAt ?? s.requestedAt ?? "") || p.sendFrom
        : s.requestedAt
          ? p.day(s.requestedAt)
          : (firstMoney ?? p.sendFrom);
      const before = !s.requestedAt && !isInvoice && settled.length > 0;
      const co = mirrorCo.get(s.id);
      const lines: InvoiceLineSpec[] = isInvoice
        ? (linesOf.get(d.id) ?? []).map((l) => ({
            item: l.cost ? ("cost" as const) : ("job" as const),
            description: l.description ? `${l.name} - ${l.description}` : l.name,
            qty: l.qty,
            unitCents: l.unitCents,
            amountCents: l.totalCents,
          }))
        : [];
      const label = (s.name ?? "").trim() || `Stage ${i + 1}`;
      // Not sent yet: on its contract's signed revision if that contract was voided since. Sent: on the job it went on.
      const sentAs = get("invoice", s.id);
      const sentOn = inQuickBooks(sentAs) || isBusy(sentAs) ? sentContractOf(sentAs!.qb_hash ?? sentAs!.doubt?.hash) : undefined;
      const spec: InvoiceSpec = {
        key: { type: "invoice", id: s.id },
        leadId: d.leadId,
        contractId: sentOn !== undefined ? sentOn : inQuickBooks(sentAs) || isBusy(sentAs) ? contractId : liveContractOf(d),
        docNumber: p.prefs.customNumbers ? docNo(isInvoice ? d.docNumber : `${d.docNumber}-${i + 1}`) : null,
        txnDay,
        dueDay: s.dueDate ?? txnDay,
        lines: lines.length
          ? lines
          : [{ item: "job", description: s.description ? `${label}: ${s.description}` : label, qty: null, unitCents: null, amountCents: s.amountCents }],
        amountCents: s.amountCents,
        privateNote: isInvoice
          ? `From the CRM · ${d.docNumber}${parent ? ` · for ${parent.docNumber}` : ""}`
          : `From the CRM · ${d.docNumber} · Stage ${i + 1} of ${stages.length}${before ? " · Paid before it was billed" : ""}`,
        customerMemo: isInvoice ? d.customerMessage : null,
        shipTo: d.jobAddress ?? parent?.jobAddress ?? null,
      };
      const should = !voided && (isInvoice ? d.status === "Signed" && (billed || !!d.issuedAt) && !s.cancelledAt : exists && !s.cancelledAt);
      // An invoice is voided, never deleted; a stage un-billed is deleted so it can be billed again.
      const voidedDoc = voided || (isInvoice && d.status === "Void");
      const taxed = co ? co.taxCents > 0 : d.taxCents > 0;
      consider(spec, should, voidedDoc, taxed, isInvoice ? d.docNumber : `${d.docNumber} ${label}`, isInvoice && voidedDoc, d.kind === "change_order" && voidedDoc);
    });
  }

  // ------------------------------------------------ what's paid, credited and refunded on them
  const childWait = (st: BillState | undefined, t: RecordType, id: string, billId: string, hash: string) => {
    if (!st || st.kind === "skip") {
      // A credit's $0.00 payment record goes with it.
      if (t === "credit") drop(get("credit_link", id));
      return drop(get(t, id));
    }
    if (st.kind === "wait") return wait(t, id, billId, st.reason, hash);
  };

  // Payments gone from the CRM: voided in QuickBooks if they went, else forgotten.
  const paymentIds = new Set(payments.map((m) => m.id));
  for (const r of records) {
    if (r.record_type !== "customer_payment" || paymentIds.has(r.record_id) || isBusy(r)) continue;
    if (inQuickBooks(r)) {
      if (billInCrm(r.bill_id) && !removalResting(r)) voids.push({ op: "void_payment", record: r });
    } else if (toldHand("customer_payment", r)) {
      // Its bill gone with its contact: left as it is, like what went (never half taken out).
      if (billInCrm(r.bill_id)) wait("customer_payment", r.record_id, r.bill_id, SALES_WAIT.undoTakenBack, r.tried_hash ?? "");
    } else if (!toldUndo(r)) drop(r);
  }

  const balance = new Map<string, number>();
  const balanceOf = (key: InvoiceKey) => {
    const id = keyText(key);
    if (!balance.has(id)) {
      const amount = leadOfKey.get(id)?.amountCents ?? 0;
      const credited = creditsOn(key)
        .filter((c) => !c.removed && inQuickBooks(get("credit", c.id)))
        .reduce((t, c) => t + c.amountCents, 0);
      const paid = payments
        .filter((m) => homeMatches(m, key) && inQuickBooks(get("customer_payment", m.id)))
        .reduce((t, m) => t + m.amountCents, 0);
      balance.set(id, amount - credited - paid);
    }
    return balance.get(id)!;
  };
  const take = (key: InvoiceKey, cents: number) => balance.set(keyText(key), balanceOf(key) - cents);

  // What payments entered by hand for their day (before the start date, or in closed books) hold of a bill: they go on
  // it in QuickBooks. Taken in the payment loop; the credit check needs it first.
  const dayWords = [opening(SALES_WAIT.closedByHand), opening(SALES_WAIT.beforeStart)];
  const heldByHandOn = (key: InvoiceKey) => {
    if (state.get(keyText(key))?.kind !== "go") return 0;
    return payments
      .filter((m) => {
        if (m.status !== "succeeded" || !homeMatches(m, key)) return false;
        const pr = get("customer_payment", m.id);
        if (inQuickBooks(pr)) return false;
        if (toldHand("customer_payment", pr)) return dayWords.some((w) => pr!.reason!.startsWith(w));
        const d = paidDay(m);
        return !cameAndWent(m) && !!d && (d < p.sendFrom || closed(d));
      })
      .reduce((t, m) => t + m.amountCents, 0);
  };

  // Credits first: they come off what's owed before payments do.
  const creditIds = new Set(p.credits.filter((c) => !c.fromRefund).map((c) => c.id));
  for (const r of records) {
    if (r.record_type !== "credit" && r.record_type !== "credit_link") continue;
    if (creditIds.has(r.record_id)) continue;
    // A credit gone from the CRM altogether: as if removed.
    if (r.record_type === "credit_link") continue;
    const lr = get("credit_link", r.record_id);
    if (isBusy(r) || isBusy(lr)) continue;
    if (inQuickBooks(r) || inQuickBooks(lr)) {
      if (billInCrm(r.bill_id) && !removalResting(r) && !removalResting(lr)) {
        voids.push({ op: "remove_credit", recordId: r.record_id, credit: inQuickBooks(r) ? r : null, link: inQuickBooks(lr) ? lr : null, invoiceId: r.bill_id });
      }
    } else {
      // Told to be entered by hand: say to take it out there.
      if (toldHand("credit", r)) {
        if (billInCrm(r.bill_id)) wait("credit", r.record_id, r.bill_id, SALES_WAIT.undoTakenBack, r.tried_hash ?? "");
      } else if (!toldUndo(r)) drop(r);
      drop(lr);
    }
  }
  for (const c of p.credits) {
    if (c.fromRefund || !c.stageId) continue;
    const key: InvoiceKey = { type: "invoice", id: c.stageId };
    const id = keyText(key);
    const cr = get("credit", c.id);
    const lr = get("credit_link", c.id);
    if (isBusy(cr) || isBusy(lr)) continue;
    if (c.removed) {
      if (voids.some((s) => s.op === "remove_credit" && s.recordId === c.id)) continue;
      if (inQuickBooks(cr) || inQuickBooks(lr)) {
        if (!removalResting(cr) && !removalResting(lr)) {
          voids.push({ op: "remove_credit", recordId: c.id, credit: inQuickBooks(cr) ? cr : null, link: inQuickBooks(lr) ? lr : null, invoiceId: key.id });
        }
      } else {
        if (toldHand("credit", cr)) wait("credit", c.id, key.id, SALES_WAIT.undoTakenBack, cr!.tried_hash ?? "");
        else if (!toldUndo(cr)) drop(cr);
        drop(lr);
      }
      continue;
    }
    // Deleted in QuickBooks: not sent again. On a bill being taken out: only its removal touches it.
    if (cr?.status === "gone" || lr?.status === "gone" || removing.has(id)) continue;
    const st = state.get(id);
    // Told to be entered by hand: so it stays (one told for its day goes on its bill there, holding that much of it).
    if (toldHand("credit", cr)) {
      if (st?.kind === "go" && cr!.reason!.startsWith(opening(SALES_WAIT.closedByHand))) take(key, c.amountCents);
      // Its bill told by hand and taken back since: take it out too.
      if (st?.kind === "wait" && st.reason === SALES_WAIT.undoTakenBack) wait("credit", c.id, key.id, SALES_WAIT.undoTakenBack, creditHash(c, key));
      else if (coMoved(cr!.reason, st)) wait("credit", c.id, key.id, SALES_WAIT.coMoneyMoved, creditHash(c, key));
      continue;
    }
    const meta = leadOfKey.get(id);
    const hash = creditHash(c, key);
    const day = p.day(c.createdAt) || p.sendFrom;
    if (inQuickBooks(cr)) {
      if (inQuickBooks(lr)) {
        if (lr!.status !== "sent") work.push({ op: "settle", recordType: "credit_link", recordId: c.id });
        if (cr!.status !== "sent") work.push({ op: "settle", recordType: "credit", recordId: c.id });
        continue;
      }
      if (st?.kind === "go" && meta && !resting(lr, hash)) {
        work.push({ op: "link_credit", credit: c, invoice: key, docNumber: meta.docNumber, leadId: meta.leadId, contractId: meta.contractId, hash, record: lr });
      }
      continue;
    }
    if (st?.kind !== "go" || !meta) {
      childWait(st, "credit", c.id, key.id, hash);
      continue;
    }
    if (p.prefs.autoApplyCredit) {
      wait("credit", c.id, key.id, SALES_WAIT.autoApply, hash);
      continue;
    }
    if (closed(day)) {
      wait("credit", c.id, key.id, SALES_WAIT.closedByHand(p.prefs.bookCloseDate!), hash);
      take(key, c.amountCents);
      continue;
    }
    // More than QuickBooks' copy of the bill has left (paid there, refunded or bounced since, or held by a payment
    // entered there by hand for its day): it can't be applied there.
    if (c.amountCents > balanceOf(key) - heldByHandOn(key)) {
      wait("credit", c.id, key.id, SALES_WAIT.creditByHand, hash);
      continue;
    }
    if (resting(cr, hash)) continue;
    take(key, c.amountCents);
    work.push({ op: "create_credit", credit: c, invoice: key, docNumber: meta.docNumber, leadId: meta.leadId, contractId: meta.contractId, hash, record: cr });
    work.push({ op: "link_credit", credit: c, invoice: key, docNumber: meta.docNumber, leadId: meta.leadId, contractId: meta.contractId, hash, record: lr });
  }

  // Payments, oldest first.
  const ordered = [...payments].sort(
    (a, b) => (a.paidAt ?? "9999").localeCompare(b.paidAt ?? "9999") || a.id.localeCompare(b.id)
  );
  const paymentGoes = new Set<string>();
  // A refund the customer still owes (a bounced check) on a bill: QuickBooks still has it paid.
  const owedAgainOn = (key: InvoiceKey, m: SyncMoney) =>
    refunds.some((r) => {
      const original = r.stillOwed === true && r.status === "succeeded" && r.refundOf !== m.id ? moneyById.get(r.refundOf!) : undefined;
      // Only one that went to QuickBooks (by the CRM, or by hand for its day): a bounce of a payment that never went
      // needs nothing there.
      return !!original && homeMatches(original, key) && (inQuickBooks(get("customer_payment", original.id)) || heldForDay.has(original.id));
    });
  const unneeded = (t: RecordType, id: string, billId: string, reason: string = SALES_WAIT.refundedAway) => {
    const r = get(t, id);
    if (isBusy(r) || inQuickBooks(r) || (r?.status === "removed" && r.reason === reason)) return;
    work.push({ op: "unneeded", recordType: t, recordId: id, billId, reason });
  };
  // A payment on this bill in QuickBooks that was refunded since (not owed): QuickBooks still has the bill paid by it.
  const refundedInQb = (key: InvoiceKey) =>
    payments.some(
      (x) =>
        homeMatches(x, key) &&
        (inQuickBooks(get("customer_payment", x.id)) || heldForDay.has(x.id)) &&
        // Standing for a twin (or waiting for one to clear): the pairing accounts for its refund.
        !standsIn.has(x.id) &&
        !(refundedInFull(x) && !!twinOf(x, key, "pending")) &&
        refundsOf(x).some((r) => filedFor(r) < -r.amountCents && !inQuickBooks(get("refund", r.id)))
    );
  /** What the CRM shows still owed on a bill, its refunds and every credit counted. */
  const orderOf = new Map(ordered.map((m, i) => [m.id, i]));
  /** What the CRM shows owed on a bill (cents), counting only the payments before `before` when given. */
  const crmOwed = (key: InvoiceKey, before?: SyncMoney) => {
    const amount = leadOfKey.get(keyText(key))?.amountCents ?? 0;
    const credited = p.credits
      .filter((c) => !c.removed && (key.type === "invoice" ? c.stageId === key.id : !c.stageId && c.docId === key.id))
      .reduce((t, c) => t + c.amountCents, 0);
    const live = (m: SyncMoney) => m.status === "succeeded" || (m.status === "pending" && !m.unfinished);
    const counted = (m: SyncMoney) => !before || (orderOf.get(m.id) ?? 0) < (orderOf.get(before.id) ?? 0);
    const paid = payments.filter((m) => homeMatches(m, key) && live(m) && counted(m)).reduce((t, m) => t + m.amountCents, 0);
    const back = refunds
      .filter((r) => {
        const o = moneyById.get(r.refundOf!);
        return live(r) && !!o && homeMatches(o, key) && counted(o);
      })
      .reduce((t, r) => t + r.amountCents, 0);
    return amount - credited - paid - back;
  };
  const crmOwes = (key: InvoiceKey) => crmOwed(key) > 0;
  /** Another payment on the bill still clearing: a short refund's reason waits for it. */
  const clearingOn = (key: InvoiceKey, except: string) =>
    payments.some((x) => x.id !== except && homeMatches(x, key) && x.status === "pending" && !x.unfinished);
  const toldByHand = (r: SyncRecord | null) => toldHand("customer_payment", r);
  const refundToldByHand = (r: SyncRecord | null) => toldHand("refund", r);
  const CLOSED_WORDS = opening(SALES_WAIT.closedByHand);
  const BEFORE_WORDS = opening(SALES_WAIT.beforeStart);
  const toldForTheDay = (reason: string | null) => !!reason && (reason.startsWith(CLOSED_WORDS) || reason.startsWith(BEFORE_WORDS));
  const pairedBefore = (x: SyncMoney) => {
    const r = get("customer_payment", x.id);
    return !!r && r.status === "removed" && r.reason === SALES_WAIT.paidTwice;
  };
  // Told to be entered by hand for its date (before sending started, or in closed books), now or before: never a twin.
  // A pairing already settled holds, though the books close on its date later.
  const toldForDate = (x: SyncMoney) => {
    if (pairedBefore(x)) return false;
    const r = get("customer_payment", x.id);
    const d = paidDay(x);
    if (d && (d < p.sendFrom || closed(d))) return true;
    return !!r && r.status === "waiting" && !!r.reason && (r.reason.startsWith(CLOSED_WORDS) || r.reason.startsWith(BEFORE_WORDS));
  };
  // The customer paid twice and the office refunded the one in QuickBooks: it stands for the one the CRM kept
  // (the same amount, on the same bill, with no refund of its own), one each.
  const twinOf = (m: SyncMoney, key: InvoiceKey, status: SyncMoney["status"]) =>
    [...payments].sort((a, b) => Number(pairedBefore(b)) - Number(pairedBefore(a))).find(
      (x) =>
        x.id !== m.id &&
        x.status === status &&
        x.amountCents === m.amountCents &&
        homeMatches(x, key) &&
        !inQuickBooks(get("customer_payment", x.id)) &&
        !toldByHand(get("customer_payment", x.id)) &&
        !toldForDate(x) &&
        // Kept: no refund of its own (one still going through or unanswered doesn't undo a pairing already settled).
        !refunds.some((r) => r.refundOf === x.id && (r.status === "succeeded" || r.status === "pending") && !(openRefund(r) && pairedBefore(x))) &&
        !standsIn.has(x.id) &&
        !stoodFor.has(x.id)
    );
  const refundedAway = new Set<string>();
  // Refunded payments in QuickBooks standing for a twin kept in the CRM, and the payments they stand for.
  const standsIn = new Set<string>();
  const stoodFor = new Set<string>();
  for (const x of payments) {
    const key = homeOf(x);
    if (!key || x.status !== "succeeded" || !inQuickBooks(get("customer_payment", x.id)) || !refundedInFull(x)) continue;
    if (refunds.some((r) => r.refundOf === x.id && (inQuickBooks(get("refund", r.id)) || refundToldByHand(get("refund", r.id))))) continue;
    const twin = twinOf(x, key, "succeeded");
    if (!twin) continue;
    standsIn.add(x.id);
    stoodFor.add(twin.id);
  }
  // Payments to be entered in QuickBooks by hand: their refunds are too. Those told for their day go on their bill
  // there, so they count as there for the payment after them.
  const byHand = new Set<string>();
  const heldForDay = new Set<string>();
  // Payments waiting for a refund on their bill to settle: their refunds wait with them.
  const openHeld = new Set<string>();
  const clearingHeld = new Set<string>();
  // Payments told by hand for their day hold their bill first, whatever the dates of the others.
  for (const m of payments) {
    const key = homeOf(m);
    const pr = get("customer_payment", m.id);
    if (!key || m.status !== "succeeded" || isBusy(pr) || !toldByHand(pr) || !toldForTheDay(pr!.reason)) continue;
    if (state.get(keyText(key))?.kind !== "go") continue;
    take(key, m.amountCents);
    heldForDay.add(m.id);
  }
  for (const m of ordered) {
    const pr = get("customer_payment", m.id);
    // Deleted in QuickBooks: not sent again.
    if (isBusy(pr) || pr?.status === "gone") continue;
    const key = homeOf(m);
    if (!key) {
      if (inQuickBooks(pr)) continue;
      if (m.status === "succeeded" && !leftOut(docById.get(m.docId)?.leadId ?? "")) wait("customer_payment", m.id, null, SALES_WAIT.noHome, "");
      else drop(pr);
      continue;
    }
    const id = keyText(key);
    const st = state.get(id);
    const meta = leadOfKey.get(id);
    const hash = paymentHash(m, key, paidDay(m));
    if (m.status === "succeeded") {
      if (inQuickBooks(pr)) {
        paymentGoes.add(m.id);
        if (pr!.qb_hash !== hash) {
          if (closed(paidDay(m))) wait("customer_payment", m.id, key.id, SALES_WAIT.closedChange(p.prefs.bookCloseDate!), hash);
          else if (!resting(pr, hash) && meta) paymentChanges.push({ op: "update_payment", money: m, invoice: key, leadId: meta.leadId, contractId: meta.contractId, hash, record: pr });
        } else if (pr!.status !== "sent") work.push({ op: "settle", recordType: "customer_payment", recordId: m.id });
        continue;
      }
      // Told to be entered by hand: it may be in QuickBooks that way, so the CRM never sends it or calls it done.
      // One told for its day goes on its bill there, so it holds that much of the bill.
      if (toldByHand(pr)) {
        byHand.add(m.id);
        // Its bill told by hand and taken back since: take it out too. (Its hold for its day is taken before the loop.)
        if (st?.kind === "wait" && st.reason === SALES_WAIT.undoTakenBack) wait("customer_payment", m.id, key.id, SALES_WAIT.undoTakenBack, hash);
        // Change-order money told to go on the other side, whose own bill goes after all: says so.
        else if (coMoved(pr!.reason, st)) wait("customer_payment", m.id, key.id, SALES_WAIT.coMoneyMoved, hash);
        // Edited in the CRM since it was told: make the same change there (the note keeps its first words; every
        // change is noted again, so it comes back to the top of Needs a look).
        else if (pr!.tried_hash && pr!.tried_hash !== hash) {
          work.push({ op: "wait", recordType: "customer_payment", recordId: m.id, billId: key.id, reason: baseReason(pr!.reason!) + CHANGED_SINCE, hash });
        }
        continue;
      }
      if (st?.kind !== "go" || !meta) {
        childWait(st, "customer_payment", m.id, key.id, hash);
        continue;
      }
      // In and straight back out (refunded in full, a bounce included, nothing taken off the bill): nothing to send.
      if (cameAndWent(m)) {
        unneeded("customer_payment", m.id, key.id);
        refundedAway.add(m.id);
        continue;
      }
      // A refund on this bill still going through or unanswered: nothing on it is told by hand until it settles (one
      // dated before the start date, or in closed books, still holds its bill meanwhile).
      const settling = openRefundOn(key);
      const pd = paidDay(m);
      if (pd && pd < p.sendFrom) {
        take(key, m.amountCents);
        if (settling) {
          wait("customer_payment", m.id, key.id, SALES_WAIT.otherRefundOpen, hash);
          openHeld.add(m.id);
          continue;
        }
        wait("customer_payment", m.id, key.id, SALES_WAIT.beforeStart(p.sendFrom), hash);
        byHand.add(m.id);
        heldForDay.add(m.id);
        continue;
      }
      // Refunded (not owed) with less taken off the bill than went back: never sent on its own, wherever the
      // balance stands, and it takes none of it.
      const back = refundsOf(m);
      if (back.some((r) => filedFor(r) < -r.amountCents)) {
        if (settling) {
          wait("customer_payment", m.id, key.id, SALES_WAIT.otherRefundOpen, hash);
          openHeld.add(m.id);
          continue;
        }
        if (clearingOn(key, m.id)) {
          wait("customer_payment", m.id, key.id, SALES_WAIT.otherClearing, hash);
          clearingHeld.add(m.id);
          continue;
        }
        const reason = notOwed.has(id)
          ? SALES_WAIT.voidedRefunded
          : crmOwes(key)
            ? SALES_WAIT.refundedOwedAgain
            : back.some((r) => filedFor(r) > 0)
              ? SALES_WAIT.overpaidRefunded
              : SALES_WAIT.refundedExtra;
        wait("customer_payment", m.id, key.id, reason, hash);
        byHand.add(m.id);
        continue;
      }
      // Its twin in QuickBooks, refunded, already stands for it.
      if (stoodFor.has(m.id)) {
        unneeded("customer_payment", m.id, key.id, SALES_WAIT.paidTwice);
        continue;
      }
      if (m.amountCents > balanceOf(key)) {
        if (settling) {
          wait("customer_payment", m.id, key.id, SALES_WAIT.otherRefundOpen, hash);
          openHeld.add(m.id);
          continue;
        }
        // Its own refunds (a deposit's are always "still owed") bring it within the bill: the extra was given back.
        const own = answeredBack(m).reduce((t, r) => t + r.amountCents, 0);
        if (own < 0 && m.amountCents + own <= balanceOf(key)) {
          wait("customer_payment", m.id, key.id, SALES_WAIT.refundedExtra, hash);
          byHand.add(m.id);
          continue;
        }
        // Paid again (or after a refund) only while the bill was still owed before this one: else a plain duplicate.
        const owedBefore = crmOwed(key, m) > 0;
        const reason = owedBefore && owedAgainOn(key, m)
          ? SALES_WAIT.paidAgain
          : owedBefore && refundedInQb(key)
            ? SALES_WAIT.paidAfterRefund
            : m.source === "stripe"
              ? SALES_WAIT.overpaidCard
              : SALES_WAIT.overpaid;
        wait("customer_payment", m.id, key.id, reason, hash);
        if (reason === SALES_WAIT.paidAgain || reason === SALES_WAIT.paidAfterRefund) byHand.add(m.id);
        continue;
      }
      if (closed(paidDay(m))) {
        // Entered there by hand, and so it stays (it may be there that way, though the month reopens).
        take(key, m.amountCents);
        if (settling) {
          wait("customer_payment", m.id, key.id, SALES_WAIT.otherRefundOpen, hash);
          openHeld.add(m.id);
          continue;
        }
        wait("customer_payment", m.id, key.id, SALES_WAIT.closedByHand(p.prefs.bookCloseDate!), hash);
        byHand.add(m.id);
        heldForDay.add(m.id);
        continue;
      }
      take(key, m.amountCents);
      if (resting(pr, hash)) continue;
      work.push({ op: "create_payment", money: m, invoice: key, leadId: meta.leadId, contractId: meta.contractId, hash, record: pr });
      paymentGoes.add(m.id);
      continue;
    }
    if (m.status === "pending" && !m.unfinished) {
      if (inQuickBooks(pr)) continue;
      if (!st || st.kind === "skip") drop(pr);
      else wait("customer_payment", m.id, key.id, SALES_WAIT.clearing, hash);
      continue;
    }
    // Failed, cancelled, or a checkout the customer left. Told to be entered by hand first: say to take it out there.
    if (inQuickBooks(pr)) {
      if (!removalResting(pr)) voids.push({ op: "void_payment", record: pr! });
    } else if (toldByHand(pr) || pr?.reason === SALES_WAIT.undoFailed) wait("customer_payment", m.id, key.id, SALES_WAIT.undoFailed, hash);
    else drop(pr);
  }

  // Refunds.
  const refundIds = new Set(refunds.map((m) => m.id));
  for (const r of records) {
    if (r.record_type !== "refund" || refundIds.has(r.record_id) || isBusy(r)) continue;
    if (inQuickBooks(r)) {
      if (billInCrm(r.bill_id) && !removalResting(r)) voids.push({ op: "delete_refund", record: r });
    } else if (toldHand("refund", r)) {
      if (billInCrm(r.bill_id)) wait("refund", r.record_id, r.bill_id, SALES_WAIT.undoTakenBack, r.tried_hash ?? "");
    } else if (!toldUndo(r)) drop(r);
  }
  for (const m of refunds) {
    const rr = get("refund", m.id);
    if (isBusy(rr) || rr?.status === "gone") continue;
    // Didn't go through (failed or cancelled at Stripe): forgotten, or, told to be entered by hand first, taken out.
    if (m.status !== "succeeded" && m.status !== "pending" && !inQuickBooks(rr)) {
      if (refundToldByHand(rr) || rr?.reason === SALES_WAIT.undoFailed) wait("refund", m.id, rr!.bill_id, SALES_WAIT.undoFailed, refundHash(m));
      else drop(rr);
      continue;
    }
    // Told to be entered by hand: it may be in QuickBooks that way, so it stays so (its bill taken back since: out too).
    if (refundToldByHand(rr)) {
      const orig = moneyById.get(m.refundOf!);
      const home = orig ? homeOf(orig) : null;
      const bst = home ? state.get(keyText(home)) : undefined;
      if (home && bst?.kind === "wait" && bst.reason === SALES_WAIT.undoTakenBack) wait("refund", m.id, home.id, SALES_WAIT.undoTakenBack, refundHash(m));
      else if (home && coMoved(rr!.reason, bst)) wait("refund", m.id, home.id, SALES_WAIT.coMoneyMoved, refundHash(m));
      continue;
    }
    // Already in QuickBooks: taken out if it didn't go through after all, whatever its payment's pairing.
    if (inQuickBooks(rr) && m.status !== "succeeded") {
      if (!removalResting(rr)) voids.push({ op: "delete_refund", record: rr! });
      continue;
    }
    // Its payment never went (it came back in full): nor does it. Or its payment stands for a twin the CRM kept.
    if (m.refundOf && (refundedAway.has(m.refundOf) || standsIn.has(m.refundOf))) {
      const orig = moneyById.get(m.refundOf);
      unneeded("refund", m.id, (orig && homeOf(orig)?.id) || "", standsIn.has(m.refundOf) ? SALES_WAIT.paidTwice : SALES_WAIT.refundedAway);
      continue;
    }
    const original = moneyById.get(m.refundOf!);
    const key = original ? homeOf(original) : null;
    const hash = refundHash(m);
    if (inQuickBooks(rr)) {
      if (m.status !== "succeeded") {
        if (!removalResting(rr)) voids.push({ op: "delete_refund", record: rr! });
      } else if (rr!.status !== "sent") work.push({ op: "settle", recordType: "refund", recordId: m.id });
      continue;
    }
    if (!original || !key) {
      drop(rr);
      continue;
    }
    const st = state.get(keyText(key));
    const meta = leadOfKey.get(keyText(key));
    const origRec = get("customer_payment", original.id);
    if (!inQuickBooks(origRec) && !paymentGoes.has(original.id)) {
      const od = paidDay(original);
      // Still going through, or still to be answered: said first (the office is told by hand only once it's settled).
      // (Never dropped while its payment is to be entered by hand: it goes there with it.)
      if ((!st || st.kind === "skip") && !byHand.has(original.id)) drop(rr);
      else if (m.status === "pending") wait("refund", m.id, key.id, SALES_WAIT.refundPending, hash);
      else if (m.stillOwed === null) wait("refund", m.id, key.id, SALES_WAIT.undecided, hash);
      else if (origRec?.status === "gone") wait("refund", m.id, key.id, SALES_WAIT.refundOfGone, hash);
      else if (byHand.has(original.id) && od && od < p.sendFrom) wait("refund", m.id, key.id, SALES_WAIT.beforeStartRefund, hash);
      else if (st?.kind === "wait") wait("refund", m.id, key.id, st.reason, hash);
      else if (byHand.has(original.id)) wait("refund", m.id, key.id, SALES_WAIT.refundByHand, hash);
      else if (openHeld.has(original.id)) wait("refund", m.id, key.id, SALES_WAIT.otherRefundOpen, hash);
      else if (clearingHeld.has(original.id)) wait("refund", m.id, key.id, SALES_WAIT.otherClearing, hash);
      else wait("refund", m.id, key.id, SALES_WAIT.paymentFirst, hash);
      continue;
    }
    // Its payment only planned this run (not in QuickBooks yet): nothing said by hand until it's there.
    if (!inQuickBooks(origRec) && m.status === "succeeded" && m.stillOwed !== null && (m.stillOwed || filedFor(m) !== -m.amountCents)) {
      wait("refund", m.id, key.id, SALES_WAIT.paymentFirst, hash);
      continue;
    }
    // Its invoice deleted or voided in QuickBooks: left alone, and so is what's on it.
    if (st?.kind === "wait" && st.reason === SALES_WAIT.billGone) {
      wait("refund", m.id, key.id, SALES_WAIT.billGone, hash);
      continue;
    }
    if (m.status === "pending") {
      wait("refund", m.id, key.id, SALES_WAIT.refundPending, hash);
      continue;
    }
    if (m.status !== "succeeded") {
      drop(rr);
      continue;
    }
    if (m.stillOwed === null) {
      wait("refund", m.id, key.id, SALES_WAIT.undecided, hash);
      continue;
    }
    if (m.stillOwed) {
      wait("refund", m.id, key.id, SALES_WAIT.owedAgain, hash);
      continue;
    }
    // Not owed: a refund receipt takes it all off what the customer owes, so only when the CRM took all of it off too.
    // Short, it says why: a voided or cancelled bill, the rest owed again, or money given back beyond the bill
    // (for a payment refunded in full whose twin is still clearing, that twin first).
    if (filedFor(m) !== -m.amountCents) {
      const reason = openRefundOn(key, m.id)
        ? SALES_WAIT.otherRefundOpen
        : clearingOn(key, original.id)
          ? SALES_WAIT.otherClearing
          : notOwed.has(keyText(key))
        ? SALES_WAIT.refundOnVoided
        : crmOwes(key)
          ? SALES_WAIT.refundOwedAgain
          : refundedInFull(original) && twinOf(original, key, "pending")
            ? SALES_WAIT.otherClearing
            : SALES_WAIT.refundBeyondBill;
      wait("refund", m.id, key.id, reason, hash);
      continue;
    }
    const account = m.source === "stripe" ? ("stripe" as const) : ("hand" as const);
    if (account === "hand" && !p.settings.handRefundsAccount) {
      wait("refund", m.id, key.id, SALES_WAIT.noRefundAccount, hash);
      continue;
    }
    if (closed(paidDay(m))) {
      wait("refund", m.id, key.id, SALES_WAIT.closedByHand(p.prefs.bookCloseDate!), hash);
      continue;
    }
    if (resting(rr, hash) || !meta) continue;
    work.push({ op: "create_refund", money: m, account, leadId: meta.leadId, contractId: meta.contractId, invoiceId: key.id, hash, record: rr });
  }

  // ------------------------------------------------ jobs for bills on them (step 2's lines)
  const ensured = new Set<string>();
  // Refused and backing off, or made inactive in QuickBooks ("gone"): not asked again until it's due, or Send now.
  const holdOff = (r: SyncRecord | null) =>
    !force &&
    !!r &&
    (r.status === "gone" || ((r.status === "failed" || r.status === "waiting") && !inQuickBooks(r) && !!r.next_try_at && new Date(r.next_try_at).getTime() > now));
  for (const link of p.billLinks) {
    if (!leadById.has(link.leadId) || leftOut(link.leadId)) continue;
    const doc = link.contractId ? docById.get(link.contractId) : undefined;
    const cr = get("customer", link.leadId);
    if (doc && doc.status === "Signed") {
      const jr = get("job", doc.id);
      if (inQuickBooks(jr) || isBusy(jr) || holdOff(jr) || ensured.has(`job:${doc.id}`)) continue;
      // Its customer refused and backing off (or in doubt): the job waits with it.
      if (!inQuickBooks(cr) && (holdOff(cr) || isBusy(cr))) continue;
      ensured.add(`job:${doc.id}`);
      ensures.push({ op: "ensure_job", contractId: doc.id, leadId: link.leadId });
    } else {
      // No contract, or a voided one: the customer.
      if (inQuickBooks(cr) || isBusy(cr) || holdOff(cr) || ensured.has(`customer:${link.leadId}`)) continue;
      ensured.add(`customer:${link.leadId}`);
      ensures.push({ op: "ensure_customer", leadId: link.leadId });
    }
  }

  // A customer or job that couldn't be added, and that nothing needs any more: cleared.
  const neededLeads = new Set([...[...leadOfKey.values()].map((v) => v.leadId), ...p.billLinks.map((l) => l.leadId)]);
  // A voided contract's job is never asked for again (its bills go on the customer).
  const signedOnly = (id: string | null) => (id && docById.get(id)?.status === "Signed" ? id : "");
  const neededJobs = new Set([...[...leadOfKey.values()].map((v) => signedOnly(v.contractId)), ...p.billLinks.map((l) => signedOnly(l.contractId))]);
  for (const r of p.records) {
    if (r.status !== "waiting" && r.status !== "failed") continue;
    if (r.record_type === "customer" && !neededLeads.has(r.record_id)) drop(r);
    if (r.record_type === "job" && !neededJobs.has(r.record_id)) drop(r);
  }

  // A payment's change goes before what uses the balance it frees (a credit, an older payment recorded since).
  return [...resolves, ...voids, ...removals, ...drops, ...ensures, ...paymentChanges, ...work];
}

/** QuickBooks' invoice numbers are at most 21 characters; a longer one is left to QuickBooks. */
function docNo(n: string): string | null {
  return n.length <= 21 ? n : null;
}

