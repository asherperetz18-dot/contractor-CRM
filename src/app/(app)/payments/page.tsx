import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canViewFinancials } from "@/lib/data/accounting-access";
import { selectAll } from "@/lib/data/select-all";
import {
  canManageBills,
  collectionsSummary,
  isAdminRole,
  moneyCents,
  paymentMethodLabel,
  phaseState,
  type EstimatePayment,
  type PortalPayment,
  type SignedContract,
} from "@/lib/data/types";
import { getStripeEnv } from "@/lib/stripe-env";
import {
  PaymentsView,
  type BilledPhaseRow,
  type DepositChaseRow,
  type PaymentHistoryRow,
} from "./payments-view";

export const dynamic = "force-dynamic";

type ContractRow = SignedContract & {
  doc_number: string;
  title: string | null;
  lead_id: string | null;
};

type LeadRow = { id: string; first_name: string | null; last_name: string | null };

// portal_payments carries lead_id; the shared PortalPayment type covers
// only what the estimate document needs, so widen it here rather than
// adding a column the other call sites don't select.
type PaymentRow = PortalPayment & { lead_id: string | null; source: string };

/**
 * Where the money is.
 *
 * This used to live at /settings/portal-payments with nothing linking to
 * it, so the only way to see what customers had paid was to type the URL
 * -- which is the same as it not existing. Settings keeps the Stripe
 * connection steps; the money itself belongs on its own page.
 */
export default async function PaymentsPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  // This page had NO permission check until now: every collected payment,
  // every contract value and every deposit still owed was readable by
  // anyone who could sign in, including Field crew and Call Center. It
  // is company-wide money like Bills and Collect, so it takes the same
  // gate. Unlike those two this genuinely narrows access -- see the PR.
  if (!canViewFinancials(profile)) {
    return (
      <div className="empty-state">
        <p className="empty-label">You don&apos;t have access to payments</p>
        <p className="empty-hint">
          Payments is company-wide money — Bookkeeping, Office and Admin, or anyone
          switched on under Settings › Users &amp; Roles › View Financials.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const env = getStripeEnv();

  const [payments, contracts, billedPhases] = await Promise.all([
    selectAll<PaymentRow>((from, to) =>
      supabase
        .from("portal_payments")
        .select("id, estimate_id, estimate_payment_id, lead_id, kind, amount_cents, status, method, source, paid_at, created_at")
        .eq("company_id", profile.company_id)
        .order("created_at", { ascending: false })
        .range(from, to)
    ),
    // Only signed estimates are contracts. A draft is not money owed.
    selectAll<ContractRow>((from, to) =>
      supabase
        .from("estimates")
        .select("id, doc_number, title, total_cents, deposit_cents, lead_id")
        .eq("company_id", profile.company_id)
        .eq("status", "Signed")
        .range(from, to)
    ),
    selectAll<EstimatePayment>((from, to) =>
      supabase
        .from("estimate_payments")
        .select("id, estimate_id, sort_order, name, description, amount_cents, requested_at, due_date")
        .eq("company_id", profile.company_id)
        .not("requested_at", "is", null)
        .order("due_date")
        .range(from, to)
    ),
  ]);

  const leadIds = [
    ...new Set([...contracts, ...payments].map((r) => r.lead_id).filter(Boolean) as string[]),
  ];
  const leads = leadIds.length
    ? await selectAll<LeadRow>((from, to) =>
        supabase
          .from("leads")
          .select("id, first_name, last_name")
          .eq("company_id", profile.company_id)
          .in("id", leadIds)
          .range(from, to)
      )
    : [];
  const nameOf = (leadId: string | null) => {
    const l = leads.find((x) => x.id === leadId);
    return [l?.first_name, l?.last_name].filter(Boolean).join(" ").trim() || "—";
  };
  const docOf = (estimateId: string) =>
    contracts.find((c) => c.id === estimateId) ?? null;

  const s = collectionsSummary(contracts, payments, billedPhases);
  const settledDeposits = new Set(
    payments.filter((p) => p.status === "succeeded" && p.kind === "deposit").map((p) => p.estimate_id)
  );

  // The rows below are the tables, flattened to plain strings and cents
  // so the client-side search can filter them without knowing anything
  // about leads or contracts. Order is decided here, once.
  const billedRows: BilledPhaseRow[] = billedPhases
    .map((ph) => {
      const c = docOf(ph.estimate_id);
      return {
        id: ph.id,
        estimateId: c?.id ?? null,
        docNumber: c?.doc_number ?? null,
        customer: c ? nameOf(c.lead_id) : "",
        phase: ph.name || "Progress payment",
        dueDate: ph.due_date ?? null,
        state: phaseState(
          ph,
          payments.filter((p) => p.estimate_payment_id === ph.id)
        ),
        amountCents: ph.amount_cents,
      };
    })
    .sort((a, b) => {
      const rank = (x: string) => (x === "overdue" ? 0 : x === "billed" ? 1 : 2);
      return rank(a.state) - rank(b.state) || (a.dueDate || "").localeCompare(b.dueDate || "");
    });

  const chaseRows: DepositChaseRow[] = contracts
    .filter((c) => (c.deposit_cents || 0) > 0 && !settledDeposits.has(c.id))
    .sort((a, b) => (b.deposit_cents || 0) - (a.deposit_cents || 0))
    .map((c) => ({
      estimateId: c.id,
      docNumber: c.doc_number,
      title: c.title || "Untitled",
      customer: nameOf(c.lead_id),
      totalCents: c.total_cents,
      depositCents: c.deposit_cents || 0,
    }));

  const historyRows: PaymentHistoryRow[] = payments.map((p) => {
    const c = docOf(p.estimate_id);
    return {
      id: p.id,
      estimateId: c?.id ?? null,
      docNumber: c?.doc_number ?? null,
      customer: nameOf(p.lead_id ?? c?.lead_id ?? null),
      kind: p.kind === "deposit" ? "Deposit" : "Progress",
      status: p.status,
      methodLabel: paymentMethodLabel(p.method) || "—",
      date: p.paid_at ?? p.created_at,
      amountCents: p.amount_cents,
      manual: p.source === "manual",
    };
  });

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Payments</h1>
          <p className="module-sub">
            Money collected through the customer portal, and what is still out on signed contracts.
          </p>
        </div>
      </div>

      {!env && (
        <p className="hint-note">
          Stripe isn&apos;t connected yet, so customers can&apos;t pay online — set it up in Admin
          Settings &rarr; Portal Payments. Signed contract totals below are still accurate.
        </p>
      )}

      <div className="stat-grid stat-grid-6">
        <div className={"stat-card stat-static" + (s.collectedCents > 0 ? " stat-card-won" : "")}>
          <div className="stat-value mono">{moneyCents(s.collectedCents)}</div>
          <div className="stat-label">Collected</div>
        </div>
        {/* Red only while something is actually late, so the colour never
            means anything but "act on this". */}
        <div className={"stat-card stat-static" + (s.overdueCents > 0 ? " stat-card-late" : "")}>
          <div className="stat-value mono">{moneyCents(s.overdueCents)}</div>
          <div className="stat-label">Overdue</div>
        </div>
        <div className={"stat-card stat-static" + (s.billedCents > 0 ? " stat-card-gold" : "")}>
          <div className="stat-value mono">{moneyCents(s.billedCents)}</div>
          <div className="stat-label">Billed, Unpaid</div>
        </div>
        <div className={"stat-card stat-static" + (s.outstandingCents > 0 ? " stat-card-gold" : "")}>
          <div className="stat-value mono">{moneyCents(s.outstandingCents)}</div>
          <div className="stat-label">Outstanding</div>
        </div>
        <div
          className={"stat-card stat-static" + (s.awaitingDepositCents > 0 ? " stat-card-gold" : "")}
        >
          <div className="stat-value mono">{moneyCents(s.awaitingDepositCents)}</div>
          <div className="stat-label">Deposits Not Paid</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(s.clearingCents)}</div>
          <div className="stat-label">Clearing (ACH)</div>
        </div>
      </div>

      <PaymentsView
        billed={billedRows}
        chase={chaseRows}
        history={historyRows}
        overdueCount={s.overdueCount}
        awaitingDepositCount={s.awaitingDepositCount}
        // Whether the history rows get a tools column at all: marking a
        // pending payment cleared takes the same permission as recording
        // one.
        showTools={canManageBills(profile)}
        canRemove={isAdminRole(profile)}
      />

      {/* Overdue counts only what was actually billed, so an untouched
          schedule on an old contract never turns red on its own. */}
      <p className="est-tax-note">
        A phase counts as overdue only once it has been billed and its due date has passed — an
        unbilled phase is work not yet done, and the customer has never been asked for it. Bill a
        phase from the contract&apos;s payment schedule.
      </p>
    </div>
  );
}
