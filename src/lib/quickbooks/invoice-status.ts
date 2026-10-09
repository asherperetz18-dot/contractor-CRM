/**
 * Where a bill to a customer stands with QuickBooks (DECISIONS #176), as
 * the Invoices page and a contract's payment schedule show it. Kept apart
 * from invoice-sync.ts, which hashes with node:crypto, so browser code can
 * use it. Pure.
 */

import { inQuickBooks, type ChipRecord, type QbChip } from "./bill-status.ts";

const OFF = "sending to QuickBooks is off";

/** The words for what went, in order: "Invoice, 2 payments and credit". */
function listWhat(parts: string[]): string {
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const count = (n: number, one: string) => (n === 1 ? [one] : n > 1 ? [`${n} ${one}s`] : []);

/**
 * A credit as the chips see it: its credit memo, and the $0.00 payment that
 * applies it to its invoice. In QuickBooks only once both are; else whichever
 * is behind (null: goes in a few minutes).
 */
export function creditChipRecord(credit: ChipRecord | null, link: ChipRecord | null): ChipRecord | null {
  if (!inQuickBooks(credit) || credit!.status !== "sent") return credit;
  if (inQuickBooks(link) && link!.status === "sent") return credit;
  return link && link.status !== "removed" ? link : null;
}

const KIND: Record<string, string> = { customer_payment: "Payment", credit: "Credit", credit_link: "Credit", refund: "Refund" };

/**
 * One bill's QuickBooks line. `payments`, `credits` and `refunds` are the
 * bill's own in the CRM that go to QuickBooks, each with its record (null
 * when none yet). `label` is "Invoice", or "Deposit invoice" for a
 * contract's deposit, whose own row already says how it was paid.
 */
export function invoiceQbChips(p: {
  /** Sending invoices is on, and QuickBooks is connected. */
  sending: boolean;
  sendFrom: string | null;
  label: "Invoice" | "Deposit invoice";
  invoice: { day: string; voided: boolean; outside: boolean };
  record: ChipRecord | null;
  payments: (ChipRecord | null)[];
  credits: (ChipRecord | null)[];
  refunds: (ChipRecord | null)[];
  /** Taken off in the CRM, but QuickBooks wouldn't let it go (failed removals on this bill). */
  stuck?: ChipRecord[];
  day: (iso: string) => string;
}): { chips: QbChip[]; qbId: string | null } {
  const r = p.record;
  const qbId = inQuickBooks(r) ? r!.qb_id : null;
  const why = (x: ChipRecord) => (x.reason ? `: ${x.reason}` : "");
  if (r?.status === "gone") {
    // Deleted there, or voided there by the bookkeeper: its reason says which.
    const text = r.reason?.startsWith("Voided in QuickBooks") ? r.reason : "Deleted in QuickBooks, so the CRM doesn't send it again";
    return { chips: [{ tone: "off", text }], qbId: null };
  }

  if (p.invoice.voided) {
    if (!r || !inQuickBooks(r)) {
      if (r?.status === "removed") return { chips: [{ tone: "off", text: "Removed from QuickBooks" }], qbId: null };
      // Voided before it ever went, with money on it: waits to be entered by hand.
      if (r?.status === "waiting") return { chips: [{ tone: "wait", text: `Waiting${why(r)}` }], qbId: null };
      if (r?.status === "failed") return { chips: [{ tone: "bad", text: `Didn't go to QuickBooks${why(r)}` }], qbId: null };
      return { chips: [], qbId: null };
    }
    if (!p.sending) return { chips: [{ tone: "wait", text: `Still in QuickBooks: ${OFF}` }], qbId };
    const held = (p.stuck ?? [])[0];
    if (held) {
      return { chips: [{ tone: "bad", text: `Still in QuickBooks: a ${(KIND[held.record_type] ?? "payment").toLowerCase()} on it couldn't be taken off first${why(held)}` }], qbId };
    }
    if (r.status === "failed" && r.failed_op === "remove") return { chips: [{ tone: "bad", text: `Couldn't remove from QuickBooks${why(r)}` }], qbId };
    if (r.status === "waiting") return { chips: [{ tone: "wait", text: `Still in QuickBooks${why(r)}` }], qbId };
    return { chips: [{ tone: "off", text: "Being removed from QuickBooks" }], qbId };
  }

  if (!r || !inQuickBooks(r)) {
    if (!p.sending) return { chips: r && r.status !== "removed" ? [{ tone: "off", text: `Not sent: ${OFF}` }] : [], qbId: null };
    if (r?.status === "waiting") return { chips: [{ tone: "wait", text: `Waiting${why(r)}` }], qbId: null };
    if (r?.status === "failed") return { chips: [{ tone: "bad", text: `Didn't go to QuickBooks${why(r)}` }], qbId: null };
    if (p.invoice.outside) return { chips: [{ tone: "off", text: "Not sent: this customer is invoiced outside the CRM (Online payments off)" }], qbId: null };
    if (!p.sendFrom) return { chips: [], qbId: null };
    if (p.invoice.day < p.sendFrom) return { chips: [{ tone: "off", text: `Before ${p.day(p.sendFrom)}: not sent` }], qbId: null };
    return { chips: [{ tone: "off", text: "Goes to QuickBooks in a few minutes" }], qbId: null };
  }

  // In QuickBooks. Did its last change go?
  if (r.status === "failed") return { chips: [{ tone: "bad", text: `In QuickBooks, but the last change didn't go${why(r)}` }], qbId };
  // Its reason says what's wrong with the one in QuickBooks (a total that doesn't match, a change to make by hand).
  if (r.status === "waiting") return { chips: [{ tone: "wait", text: r.reason || "In QuickBooks; it needs a look" }], qbId };

  // Everything paid, credited and refunded on it, too?
  // Still to go, or in trouble. One noted as needing nothing ("removed" while still in the CRM: it came in and went back out) is done.
  const open = (list: (ChipRecord | null)[]) =>
    list.filter((x) => x?.status !== "removed" && (!inQuickBooks(x) || x!.status === "failed" || x!.status === "waiting"));
  const kinds: [string, (ChipRecord | null)[]][] = [
    ["Payment", p.payments],
    ["Credit", p.credits],
    ["Refund", p.refunds],
  ];
  const pendingKinds = kinds.filter(([, list]) => open(list).length);
  const stuck = p.stuck ?? [];
  // What's in QuickBooks on it (one needing nothing isn't counted).
  const counted = (list: (ChipRecord | null)[]) => list.filter((x) => x?.status !== "removed");
  if (!pendingKinds.length && !stuck.length) {
    const latest = [r, ...counted(p.payments), ...counted(p.credits), ...counted(p.refunds)]
      .map((x) => x?.sent_at ?? null)
      .filter((x): x is string => !!x)
      .sort()
      .pop();
    const when = latest ? ` · ${p.day(latest)}` : "";
    if (p.label === "Deposit invoice") return { chips: [{ tone: "good", text: `✓ Deposit invoice in QuickBooks${when}` }], qbId };
    const what = listWhat([
      "Invoice",
      ...count(counted(p.payments).length, "payment"),
      ...count(counted(p.credits).length, "credit"),
      ...count(counted(p.refunds).length, "refund"),
    ]);
    return { chips: [{ tone: "good", text: `✓ In QuickBooks · ${what}${when}` }], qbId };
  }
  const chips: QbChip[] = [{ tone: "good", text: `✓ ${p.label} in QuickBooks` }];
  for (const [label, list] of pendingKinds) {
    const x = open(list)[0];
    chips.push(
      x?.status === "gone"
        ? { tone: "off", text: `${label} deleted in QuickBooks, so the CRM doesn't send it again` }
        : !p.sending
          ? { tone: "off", text: `${label} not sent: ${OFF}` }
          : x?.status === "failed"
            ? inQuickBooks(x)
              ? { tone: "bad", text: `${label} in QuickBooks, but its last change didn't go${why(x)}` }
              : { tone: "bad", text: `${label} didn't go${why(x)}` }
            : x?.status === "waiting"
              ? inQuickBooks(x)
                ? { tone: "wait", text: `${label} in QuickBooks; its change waits${why(x)}` }
                : { tone: "wait", text: `${label} waiting${why(x)}` }
              : { tone: "off", text: `${label} goes in a few minutes` }
    );
  }
  for (const x of stuck) chips.push({ tone: "bad", text: `${KIND[x.record_type] ?? "Payment"} taken off in the CRM is still in QuickBooks${why(x)}` });
  return { chips, qbId };
}

/** What the Invoices page knows about QuickBooks: null when invoices never went. */
export type InvoicesQuickBooks = {
  sending: boolean;
  sendFrom: string | null;
  environment: "sandbox" | "production";
  realmId: string;
};
