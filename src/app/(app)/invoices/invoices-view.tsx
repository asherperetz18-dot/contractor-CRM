"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { NewInvoiceModal } from "@/components/invoices/new-invoice-modal";
import { moneyCents } from "@/lib/data/types";
import {
  INVOICE_STATUS_LABEL,
  daysLate,
  invoiceQueryString,
  type InvoicePeriod,
  type InvoiceQuery,
  type InvoiceRow,
  type InvoiceStatus,
  type InvoiceStatusGroup,
  type InvoiceSummary,
} from "@/lib/data/invoice-rows";

export type InvoiceListRow = InvoiceRow & { customer: string };

/** Rows drawn at a time; the cards above count every bill. */
const PAGE = 200;

const GROUPS: { key: InvoiceStatusGroup; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
  { key: "all", label: "All" },
];

const PERIODS: { key: InvoicePeriod; label: string }[] = [
  { key: "all", label: "Billed any time" },
  { key: "30", label: "Billed in the last 30 days" },
  { key: "90", label: "Billed in the last 90 days" },
  { key: "365", label: "Billed in the last 12 months" },
];

const STATUS_COLOR: Record<InvoiceStatus, string> = {
  billed: "#5F6B7A",
  viewed: "#2D5F8A",
  partial: "#B7791F",
  overdue: "#C0392B",
  clearing: "#2C7A7B",
  paid: "#2F855A",
  void: "#8A8F98",
  credit: "#6B46C1",
};

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** The line under a status: what makes it that status. */
function statusNote(r: InvoiceListRow, today: string): string | null {
  if (r.status === "overdue") return `${days(daysLate(r.dueDate, today))} late`;
  if (r.status === "partial") return `${moneyCents(r.paidCents)} of ${moneyCents(r.amountCents)} paid`;
  if (r.status === "viewed" && r.viewedAt) return `Opened ${fmt(r.viewedAt)}`;
  return null;
}

/** The line under a due date: how far off it is, for a bill still owed. */
function dueNote(r: InvoiceListRow, today: string): string | null {
  if (!r.dueDate || r.owedCents <= 0 || r.status === "clearing") return null;
  const late = daysLate(r.dueDate, today);
  if (late > 0) return null; // the status says how late
  if (late === 0) return "Due today";
  return `In ${days(-late)}`;
}

export function InvoicesView({
  query,
  today,
  rows,
  counts,
  summary,
  canCreate,
}: {
  query: InvoiceQuery;
  today: string;
  rows: InvoiceListRow[];
  counts: Record<InvoiceStatusGroup, number>;
  summary: InvoiceSummary;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<InvoiceStatusGroup>(query.status);
  const [period, setPeriod] = useState<InvoicePeriod>(query.period);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  // The filter and period ride in the address and the server sends only
  // those rows -- in a transition, so the list stays on screen, faded,
  // until the new ones arrive.
  const [pending, startLoad] = useTransition();
  const wantedQs = invoiceQueryString({ status, period });
  const loadedQs = invoiceQueryString(query);
  useEffect(() => {
    if (wantedQs !== loadedQs) startLoad(() => router.replace(`/invoices${wantedQs}`, { scroll: false }));
  }, [wantedQs, loadedQs, router]);
  const loading = pending || wantedQs !== loadedQs;

  const q = search.trim().toLowerCase();
  const matched = q
    ? rows.filter(
        (r) =>
          r.docNumber.toLowerCase().includes(q) ||
          r.customer.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          (r.stage ?? "").toLowerCase().includes(q)
      )
    : rows;

  // A page of rows at a time; another filter starts again from one page.
  const filterSig = `${wantedQs}|${q}`;
  const [more, setMore] = useState({ sig: filterSig, count: PAGE });
  const shownCount = more.sig === filterSig ? more.count : PAGE;

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Invoices</h1>
          <p className="module-sub">
            Everything you&apos;ve billed customers: invoices, and the stages of contracts and change
            orders
          </p>
        </div>
        {canCreate && (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            + New invoice
          </button>
        )}
      </div>

      <div className="stat-grid">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(summary.outstanding.cents)}</div>
          <div className="stat-label">Outstanding · {summary.outstanding.count} open</div>
        </div>
        <div className={"stat-card stat-static" + (summary.overdue.count ? " digest-urgent" : "")}>
          <div className="stat-value mono">{moneyCents(summary.overdue.cents)}</div>
          <div className="stat-label">Overdue · {summary.overdue.count}</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(summary.billed30.cents)}</div>
          <div className="stat-label">Billed, last 30 days · {summary.billed30.count}</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(summary.paid30.cents)}</div>
          <div className="stat-label">Paid, last 30 days · {summary.paid30.count}</div>
        </div>
      </div>

      <div className="filter-bar">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            className={"chip" + (status === g.key ? " chip-active" : "")}
            onClick={() => setStatus(g.key)}
          >
            {g.label}
            {counts[g.key] > 0 && <span className="count-pill">{counts[g.key]}</span>}
          </button>
        ))}
        <select
          aria-label="When it was billed"
          value={period}
          onChange={(e) => setPeriod(e.target.value as InvoicePeriod)}
        >
          {PERIODS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          className="ur-search"
          style={{ maxWidth: 320, marginBottom: 0, marginLeft: "auto" }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search number, customer, project…"
        />
      </div>

      <div className={"invoices-body" + (loading ? " is-loading" : "")} aria-busy={loading}>
        {matched.length === 0 ? (
          <div className="empty-state">
            <p className="empty-label">{loading ? "Loading…" : "Nothing here"}</p>
            <p className="empty-hint">
              {loading
                ? ""
                : q
                  ? "No bill matches that search."
                  : status === "open"
                    ? "Nothing is waiting to be paid."
                    : "No bills match these filters."}
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Customer</th>
                  <th>For</th>
                  <th>Billed</th>
                  <th>Due</th>
                  <th className="right">Amount</th>
                  <th className="right">Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {matched.slice(0, shownCount).map((r) => {
                  const note = statusNote(r, today);
                  const due = dueNote(r, today);
                  return (
                    <tr key={r.id}>
                      <td className="mono">
                        <Link href={`/estimates/${r.docId}`} className="ur-name">
                          {r.docNumber}
                        </Link>
                      </td>
                      <td>{r.customer}</td>
                      <td>
                        {r.stage ?? r.title}
                        {r.stage && <div className="est-tax-note">{r.title}</div>}
                      </td>
                      <td className="mono">{fmt(r.billedAt)}</td>
                      <td className="mono">
                        {fmt(r.dueDate)}
                        {due && <div className="est-tax-note">{due}</div>}
                      </td>
                      <td className="right mono">{moneyCents(r.amountCents)}</td>
                      <td className="right mono">{r.owedCents > 0 ? moneyCents(r.owedCents) : "—"}</td>
                      <td>
                        <Badge color={STATUS_COLOR[r.status]}>{INVOICE_STATUS_LABEL[r.status]}</Badge>
                        {note && (
                          <div className={"est-tax-note" + (r.status === "overdue" ? " proj-check-overdue" : "")}>
                            {note}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {matched.length > shownCount && (
          <div className="invoices-more">
            <span className="empty-hint">
              Showing {shownCount} of {matched.length} bills
            </span>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setMore({ sig: filterSig, count: shownCount + PAGE })}
            >
              Show more
            </button>
          </div>
        )}
      </div>

      {creating && (
        <NewInvoiceModal
          onClose={() => setCreating(false)}
          onIssued={({ id }) => router.push(`/estimates/${id}`)}
        />
      )}
    </div>
  );
}
