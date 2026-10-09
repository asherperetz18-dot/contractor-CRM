import { clientName } from "@/lib/data/client-name";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getRoleNamesCached } from "@/lib/data/company-chrome";
import { companyToday } from "@/lib/data/company-today";
import { roleName } from "@/lib/role-names";
import { canViewFinancials } from "@/lib/data/accounting-access";
import { canCreateEstimates } from "@/lib/data/types";
import { loadInvoiceRows } from "@/lib/data/load-invoice-rows";
import {
  INVOICE_STATUS_GROUPS,
  billedWithin,
  inStatusGroup,
  invoiceSummary,
  parseInvoiceQuery,
  type InvoiceStatusGroup,
} from "@/lib/data/invoice-rows";
import { invoiceRowsQuickBooks } from "@/lib/quickbooks/invoice-chips";
import { InvoicesView, type InvoiceListRow } from "./invoices-view";

export const dynamic = "force-dynamic";

/**
 * Invoices (DECISIONS #148): everything the company has billed a
 * customer -- invoices, and the stages of contracts and change orders --
 * with where each one stands. The status filter and the billed-date
 * period ride in the address; the cards count every bill whatever the
 * filters. Money to Collect is the open part of the same rows.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; period?: string }>;
}) {
  const query = parseInvoiceQuery(await searchParams);
  const profile = await getCurrentProfile();
  if (!profile) return null;

  // The same door as Money to Collect: company-wide money.
  if (!canViewFinancials(profile)) {
    const bookkeeping = roleName(await getRoleNamesCached(profile.company_id), "Bookkeeping");
    return (
      <div className="empty-state">
        <p className="empty-label">You don&apos;t have access to invoices</p>
        <p className="empty-hint">
          Invoices is company-wide money — {bookkeeping}, Office and Admin, or anyone switched on
          under Settings › Users &amp; Roles › View Financials.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const today = await companyToday();
  const now = new Date();
  const { rows, payments, leadById } = await loadInvoiceRows(supabase, profile.company_id, today, { views: true });

  const inPeriod = rows.filter((r) => billedWithin(r.billedAt, query.period, now));
  const counts = Object.fromEntries(
    INVOICE_STATUS_GROUPS.map((g) => [g, inPeriod.filter((r) => inStatusGroup(r.status, g)).length])
  ) as Record<InvoiceStatusGroup, number>;

  // Still owed: the latest first to chase, by due date. Everything else:
  // the newest bills first.
  const open = query.status === "open" || query.status === "overdue";
  const shown: InvoiceListRow[] = inPeriod
    .filter((r) => inStatusGroup(r.status, query.status))
    .sort((a, b) =>
      open
        ? (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.billedAt.localeCompare(b.billedAt)
        : b.billedAt.localeCompare(a.billedAt)
    )
    .map((r) => ({ ...r, customer: clientName(leadById.get(r.leadId)) || "Unnamed" }));
  // Where each one stands with QuickBooks (DECISIONS #183), for the rows drawn.
  const qb = await invoiceRowsQuickBooks(profile.company_id, shown);
  for (const r of shown) r.qb = qb.get(r.id);

  return (
    <InvoicesView
      query={query}
      today={today}
      rows={shown}
      counts={counts}
      summary={invoiceSummary(rows, payments, now)}
      canCreate={canCreateEstimates(profile)}
    />
  );
}
