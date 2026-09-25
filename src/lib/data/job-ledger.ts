/**
 * The Transactions list under a Projects row: every dollar on one job --
 * paid in, paid out, still owed -- on one timeline.
 *
 * It itemizes the row's own figures, so it applies the row's rules
 * (`buildProjectCards`): the job's documents are the contract, its change
 * orders and its live invoices; Owed is each billed phase's unpaid
 * remainder (`phaseReceivableCents`); Spent is costs filed to the job's
 * phases, plus unfiled costs only when this is the customer's one
 * contract; Bills unpaid follows the same filing rule. A pending payment
 * shows (as clearing) but counts nowhere, same as Collected.
 */
import { contractChildDocs } from "./invoices.ts";
import { paymentMethodLabel, type PortalPayment } from "./types.ts";

export type JobLedgerInput = {
  contractId: string;
  /** The contract and the documents attached to it (any status). */
  docs: {
    id: string;
    kind: string | null;
    status: string;
    doc_number: string;
    title: string | null;
    total_cents: number;
  }[];
  /** Every phase on the customer's documents, so a cost filed to a phase
   *  that no longer exists reads as unfiled, the row's own rule. */
  phases: {
    id: string;
    estimate_id: string;
    name: string;
    sort_order: number;
    amount_cents: number;
    requested_at: string | null;
    due_date: string | null;
  }[];
  payments: {
    id: string;
    estimate_id: string;
    estimate_payment_id: string | null;
    kind: string;
    amount_cents: number;
    status: PortalPayment["status"];
    method: string | null;
    reference?: string | null;
    paid_at: string | null;
    created_at: string;
  }[];
  /** The customer's job costs (paid bills and costs). */
  costs: {
    id: string;
    description: string | null;
    category: string | null;
    vendorName: string | null;
    amount_cents: number;
    spent_on: string;
    estimate_payment_id: string | null;
    receipt_url: string | null;
    receipt_path: string | null;
    source: string;
  }[];
  /** The customer's signed contracts (cancelled ones included), which
   *  decides whether unfiled costs are this job's. */
  contractsOnLead: number;
  openBills: {
    id: string;
    estimate_payment_id: string | null;
    vendorName: string | null;
    reference: string | null;
    amount_cents: number;
    remaining_cents: number;
    bill_date: string | null;
    due_date: string | null;
    receipt_url: string | null;
    receipt_path: string | null;
  }[];
  /** Cost id -> the invoice that bills it back to the customer. */
  billedOn: Record<string, string>;
  /** An instant as a day on the company's calendar. Defaults to UTC. */
  toDay?: (iso: string) => string;
};

export type LedgerKind = "in" | "clearing" | "out" | "owed" | "unpaid_bill";

export type LedgerEntry = {
  id: string;
  kind: LedgerKind;
  /** YYYY-MM-DD, on the company's calendar. */
  date: string;
  title: string;
  detail: string;
  amountCents: number;
  /** The document a payment or owed line is on. */
  docId: string | null;
  isInvoice: boolean;
  phaseId: string | null;
  costId: string | null;
  billId: string | null;
  receipt: { url: string; path: string | null } | null;
  /** On a paid-out cost: the invoice that bills it to the customer. */
  billedOn: string | null;
  /** On a cost: how it was recorded ('bill' ones are edited in Bills to Pay). */
  source: string | null;
};

export type LedgerFilter = "all" | "in" | "out" | "owed";

type Cost = JobLedgerInput["costs"][number];

/** "2026-09-25" -> "Sep 25". */
function shortDay(isoDay: string): string {
  const d = new Date(`${isoDay}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? isoDay
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function jobLedger(input: JobLedgerInput): {
  entries: LedgerEntry[];
  totals: { collectedCents: number; owedCents: number; spentCents: number; billsUnpaidCents: number };
  /** Costs that no contract claims, when the customer has several. */
  unassigned: Cost[];
} {
  const toDay = input.toDay ?? ((iso: string) => iso.slice(0, 10));
  const contract = input.docs.find((d) => d.id === input.contractId);
  const { changeOrders, invoices } = contractChildDocs(
    input.docs.filter((d) => d.id !== input.contractId)
  );
  const jobDocs = [...(contract ? [contract] : []), ...changeOrders, ...invoices];
  const docById = new Map(jobDocs.map((d) => [d.id, d]));
  const ownPhases = input.phases.filter((p) => docById.has(p.estimate_id));
  const ownPhaseIds = new Set(ownPhases.map((p) => p.id));
  const phaseById = new Map(input.phases.map((p) => [p.id, p]));
  const soleContract = input.contractsOnLead <= 1;

  const docLabel = (id: string) => {
    const d = docById.get(id);
    return d ? [d.doc_number, d.title].filter(Boolean).join(" · ") : "";
  };
  const isInvoice = (docId: string) => docById.get(docId)?.kind === "invoice";

  const entries: LedgerEntry[] = [];
  const blank = {
    docId: null,
    isInvoice: false,
    phaseId: null,
    costId: null,
    billId: null,
    receipt: null,
    billedOn: null,
    source: null,
  };

  // Money in, and money on its way.
  const paidByPhase = new Map<string, number>();
  for (const p of input.payments) {
    if (!docById.has(p.estimate_id)) continue;
    if (p.status !== "succeeded" && p.status !== "pending") continue;
    if (p.status === "succeeded" && p.estimate_payment_id) {
      paidByPhase.set(p.estimate_payment_id, (paidByPhase.get(p.estimate_payment_id) ?? 0) + p.amount_cents);
    }
    const phase = p.estimate_payment_id ? phaseById.get(p.estimate_payment_id) : undefined;
    const onContract = p.estimate_id === input.contractId;
    const title = !onContract
      ? docLabel(p.estimate_id)
      : p.kind === "deposit"
        ? "Deposit"
        : phase?.name || "Payment";
    const method = paymentMethodLabel(p.method);
    const how = method ? method.charAt(0).toUpperCase() + method.slice(1) : "";
    entries.push({
      ...blank,
      id: `pay-${p.id}`,
      kind: p.status === "succeeded" ? "in" : "clearing",
      date: toDay(p.paid_at ?? p.created_at),
      title,
      detail: [how + (p.reference ? ` #${p.reference}` : ""), p.status === "pending" ? "clearing" : ""]
        .filter(Boolean)
        .join(" · "),
      amountCents: p.amount_cents,
      docId: p.estimate_id,
      isInvoice: isInvoice(p.estimate_id),
      phaseId: p.estimate_payment_id,
    });
  }

  // Still owed: each billed phase's unpaid remainder.
  for (const ph of ownPhases) {
    if (!ph.requested_at) continue;
    const owed = Math.max(0, ph.amount_cents - (paidByPhase.get(ph.id) ?? 0));
    if (owed === 0) continue;
    const invoice = isInvoice(ph.estimate_id);
    entries.push({
      ...blank,
      id: `owed-${ph.id}`,
      kind: "owed",
      date: toDay(ph.requested_at),
      title: invoice || ph.estimate_id !== input.contractId ? docLabel(ph.estimate_id) : ph.name || "Payment",
      detail: [
        invoice ? "invoice" : docById.get(ph.estimate_id)?.doc_number,
        ph.due_date ? `due ${shortDay(ph.due_date)}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      amountCents: owed,
      docId: ph.estimate_id,
      isInvoice: invoice,
      phaseId: ph.id,
    });
  }

  // Money out: costs filed to this job, and unfiled ones when it's the
  // customer's only contract.
  const unassigned: Cost[] = [];
  for (const c of input.costs) {
    const filed = !!c.estimate_payment_id && phaseById.has(c.estimate_payment_id);
    const mine = filed ? ownPhaseIds.has(c.estimate_payment_id!) : soleContract;
    if (!filed && !soleContract) unassigned.push(c);
    if (!mine) continue;
    entries.push({
      ...blank,
      id: `cost-${c.id}`,
      kind: "out",
      date: c.spent_on,
      title: c.description?.trim() || c.category?.trim() || c.vendorName || "Cost",
      detail: c.vendorName ?? "",
      amountCents: c.amount_cents,
      costId: c.id,
      receipt: c.receipt_url ? { url: c.receipt_url, path: c.receipt_path } : null,
      billedOn: input.billedOn[c.id] ?? null,
      source: c.source,
    });
  }

  // Bills not paid yet, same filing rule.
  for (const b of input.openBills) {
    if (b.remaining_cents <= 0) continue;
    const mine = b.estimate_payment_id ? ownPhaseIds.has(b.estimate_payment_id) : soleContract;
    if (!mine) continue;
    entries.push({
      ...blank,
      id: `bill-${b.id}`,
      kind: "unpaid_bill",
      date: b.bill_date ?? b.due_date ?? "",
      title: b.reference || b.vendorName || "Bill",
      detail: [b.reference ? b.vendorName : "", b.due_date ? `due ${shortDay(b.due_date)}` : ""]
        .filter(Boolean)
        .join(" · "),
      amountCents: b.remaining_cents,
      billId: b.id,
      receipt: b.receipt_url ? { url: b.receipt_url, path: b.receipt_path } : null,
    });
  }

  entries.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const sum = (kind: LedgerKind) =>
    entries.filter((e) => e.kind === kind).reduce((s, e) => s + e.amountCents, 0);
  return {
    entries,
    totals: {
      collectedCents: sum("in"),
      owedCents: sum("owed"),
      spentCents: sum("out"),
      billsUnpaidCents: sum("unpaid_bill"),
    },
    unassigned,
  };
}

const IN_FILTER: Record<LedgerFilter, (k: LedgerKind) => boolean> = {
  all: () => true,
  in: (k) => k === "in" || k === "clearing",
  out: (k) => k === "out",
  owed: (k) => k === "owed" || k === "unpaid_bill",
};

export function ledgerFilter(entries: LedgerEntry[], filter: LedgerFilter): LedgerEntry[] {
  return entries.filter((e) => IN_FILTER[filter](e.kind));
}

export function ledgerCounts(entries: LedgerEntry[]): Record<LedgerFilter, number> {
  return {
    all: entries.length,
    in: ledgerFilter(entries, "in").length,
    out: ledgerFilter(entries, "out").length,
    owed: ledgerFilter(entries, "owed").length,
  };
}

/** Which rows have their list open, and on which filter. Clicking what
 *  is already showing closes it; anything else opens or switches. */
export function toggleLedger(
  open: Record<string, LedgerFilter>,
  id: string,
  filter: LedgerFilter
): Record<string, LedgerFilter> {
  const next = { ...open };
  if (next[id] === filter) delete next[id];
  else next[id] = filter;
  return next;
}
