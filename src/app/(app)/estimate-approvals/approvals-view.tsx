"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { moneyCents } from "@/lib/data/types";
import {
  approvalFilterOptions,
  filterApprovals,
  normalizeApprovalFilters,
  type ApprovalsSort,
} from "@/lib/approvals-filters";
import {
  approveEstimate,
  setApprovalSetting,
  type PendingApproval,
} from "@/lib/actions/estimate-approval";

/**
 * The approvals list, and the switch that makes approval mandatory.
 *
 * The switch lives here rather than in Settings on purpose: this is the
 * screen that shows what turning it on would hold up, so the decision is
 * made looking at its consequences instead of two menus away from them.
 */
export function ApprovalsView({
  initialPending,
  initialRequired,
  loadError,
}: {
  initialPending: PendingApproval[];
  initialRequired: boolean;
  loadError?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(initialPending);
  const [required, setRequired] = useState(initialRequired);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState(loadError ?? "");
  const [working, setWorking] = useState("");
  // The dropdowns over the three columns the eye scans: whose customer,
  // who wrote it, and how much it's worth. Options come from the rows
  // themselves (approvalFilterOptions), so approving the last of
  // somebody's drafts drops their name from the filter too.
  const [customerFilter, setCustomerFilter] = useState("");
  const [writerFilter, setWriterFilter] = useState("");
  const [sort, setSort] = useState<ApprovalsSort>("newest");

  const options = useMemo(() => approvalFilterOptions(pending), [pending]);
  // A selection whose last draft was just approved reads as "all" again
  // -- normalized for the selects AND the filtering, so the two can
  // never disagree about what is being shown.
  const filters = useMemo(
    () => normalizeApprovalFilters(pending, { customer: customerFilter, writtenBy: writerFilter }),
    [pending, customerFilter, writerFilter]
  );
  const visible = useMemo(
    () => filterApprovals(pending, { ...filters, sort }),
    [pending, filters, sort]
  );

  async function handleApprove(id: string) {
    setWorking(id);
    setError("");
    const res = await approveEstimate(id);
    setWorking("");
    if (res.error) return setError(res.error);
    // Dropped from the list rather than re-fetching the page: the row is
    // gone from "waiting on me" the moment it is approved.
    setPending((rows) => rows.filter((r) => r.id !== id));
    router.refresh();
  }

  return (
    <div className="est-pay">
      <div className="portal-status-row">
        <span className="portal-status-label">Require approval before sending</span>
        {required ? (
          <span className="portal-status-ok">
            ✓ On — nothing goes out until it is approved here
          </span>
        ) : (
          <span className="portal-status-none">
            Off — anyone who can send an estimate can send it unchecked
          </span>
        )}
        <button
          type="button"
          className="btn-ghost small"
          disabled={busy}
          onClick={() =>
            startTransition(async () => {
              const next = !required;
              setError("");
              const res = await setApprovalSetting(next);
              if (res.error) return setError(res.error);
              setRequired(next);
              router.refresh();
            })
          }
        >
          {busy ? "Saving…" : required ? "Turn off" : "Turn on"}
        </button>
      </div>

      {!required && pending.length > 0 && (
        <p className="est-tax-note">
          Approval is off, so these can go out without you. Approving them now still records
          that you checked them.
        </p>
      )}

      {error && <p className="error-note">{error}</p>}

      {pending.length > 0 && (
        <div className="form-row">
          <label className="field">
            <span className="field-label">Customer</span>
            <select value={filters.customer} onChange={(e) => setCustomerFilter(e.target.value)}>
              <option value="">All customers</option>
              {options.customers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Written by</span>
            <select value={filters.writtenBy} onChange={(e) => setWriterFilter(e.target.value)}>
              <option value="">Everyone</option>
              {options.writers.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as ApprovalsSort)}>
              <option value="newest">Newest first</option>
              <option value="value_desc">Highest value first</option>
              <option value="value_asc">Lowest value first</option>
            </select>
          </label>
          <div className="field">
            <span className="field-label">&nbsp;</span>
            <p className="est-tax-note" style={{ margin: 0 }}>
              {visible.length === pending.length
                ? `${pending.length} waiting`
                : `${visible.length} of ${pending.length} waiting`}
            </p>
          </div>
        </div>
      )}

      {pending.length === 0 ? (
        <p className="empty-hint">Nothing waiting. Every draft has been checked.</p>
      ) : visible.length === 0 ? (
        <p className="empty-hint">
          No drafts match these filters — clear them to see all {pending.length} waiting.
        </p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Document</th>
              <th>Customer</th>
              <th>Written by</th>
              <th className="right">Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/estimates/${row.id}`}>
                    {row.doc_number ?? "Draft"}
                  </Link>
                  {row.title && <div className="est-tax-note">{row.title}</div>}
                </td>
                <td>{row.customer ?? "—"}</td>
                <td>{row.writtenBy ?? "—"}</td>
                <td className="right mono">
                  {row.total_cents != null ? moneyCents(row.total_cents) : "—"}
                </td>
                <td className="right">
                  {/* Read it first. An Approve button that is quicker to
                      press than the document is to open turns this whole
                      screen into a rubber stamp. */}
                  <Link href={`/estimates/${row.id}`} className="btn-ghost small">
                    Open
                  </Link>{" "}
                  <button
                    type="button"
                    className="btn-primary small"
                    disabled={working === row.id}
                    onClick={() => handleApprove(row.id)}
                  >
                    {working === row.id ? "Approving…" : "Approve"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
