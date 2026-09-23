"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ApproveEstimateButton } from "@/components/approve-estimate-button";
import { moneyCents } from "@/lib/data/types";
import type { FlowStatusKey } from "@/lib/estimate-flow-status";
import {
  estimateStatusFilterOptions,
  filterEstimateStatusRows,
  type EstimateStatusFilter,
} from "@/lib/estimate-status-filters";

export type StatusRow = {
  id: string;
  docNumber: string | null;
  title: string | null;
  customer: string;
  totalCents: number | null;
  closerId: string | null;
  closerName: string | null;
  rep1Id: string | null;
  rep1Name: string | null;
  rep2Id: string | null;
  rep2Name: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  flowKey: FlowStatusKey;
  flowLabel: string;
  flowColor: string;
};

// The status dropdown's entries, in the order the gates fire on a real
// send -- the same order estimateFlowStatus evaluates them.
const STATUS_OPTIONS: { key: FlowStatusKey; label: string }[] = [
  { key: "awaiting_approval", label: "Waiting for admin approval" },
  { key: "closer_sends", label: "Closer reviews & sends" },
  { key: "ready_to_send", label: "Ready to send" },
  { key: "awaiting_customer", label: "Waiting on the customer" },
  { key: "signed", label: "Signed" },
];

function day(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function EstimateStatusView({ rows, canApprove }: { rows: StatusRow[]; canApprove: boolean }) {
  const [filter, setFilter] = useState<EstimateStatusFilter>({ status: "", closer: "", rep: "", search: "" });
  const options = useMemo(() => estimateStatusFilterOptions(rows), [rows]);
  const visible = useMemo(() => filterEstimateStatusRows(rows, filter), [rows, filter]);
  const set = (patch: Partial<EstimateStatusFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const filtering = Boolean(filter.status || filter.closer || filter.rep || filter.search.trim());

  if (rows.length === 0) {
    return (
      <p className="empty-label">
        Nothing in flight. Documents appear here the moment a draft exists, and signed ones drop
        off after 30 days.
      </p>
    );
  }

  return (
    <>
      <div className="est-status-filters">
        <label className="field">
          <span className="field-label">Status</span>
          <select value={filter.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Closer</span>
          <select value={filter.closer} onChange={(e) => set({ closer: e.target.value })}>
            <option value="">All closers</option>
            {options.closers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Rep</span>
          <select value={filter.rep} onChange={(e) => set({ rep: e.target.value })}>
            <option value="">All reps</option>
            {options.reps.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Customer</span>
          <input
            type="search"
            value={filter.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Search by name"
          />
        </label>
        <div className="field">
          <span className="field-label">&nbsp;</span>
          <p className="est-tax-note est-status-count">
            {filtering ? `${visible.length} of ${rows.length} in flight` : `${rows.length} in flight`}
            {filtering && (
              <button
                type="button"
                className="btn-ghost small"
                onClick={() => setFilter({ status: "", closer: "", rep: "", search: "" })}
              >
                Clear
              </button>
            )}
          </p>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="empty-label">Nothing matches these filters.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table est-status-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Closer</th>
                <th>Rep 1</th>
                <th>Rep 2</th>
                <th>Customer</th>
                <th>Client view</th>
                <th className="right">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td className="est-status-doc">
                    <Link href={`/estimates/${r.id}`}>
                      {r.docNumber || "Draft"}
                      {r.title ? ` · ${r.title}` : ""}
                    </Link>
                  </td>
                  <td>{r.closerName ?? <span className="est-status-none">—</span>}</td>
                  <td>{r.rep1Name ?? <span className="est-status-none">—</span>}</td>
                  <td>{r.rep2Name ?? <span className="est-status-none">—</span>}</td>
                  <td>{r.customer}</td>
                  <td>
                    <span className="est-status-view">
                      {r.viewedAt ? (
                        <span title={r.viewedAt}>👁 Viewed {day(r.viewedAt)}</span>
                      ) : r.sentAt ? (
                        <span className="est-status-none">Sent {day(r.sentAt)}, not opened</span>
                      ) : (
                        <span className="est-status-none">Not sent</span>
                      )}
                      <Link href={`/estimates/${r.id}/preview`} className="est-status-preview">
                        Preview
                      </Link>
                    </span>
                  </td>
                  <td className="right mono">{r.totalCents ? moneyCents(r.totalCents) : "—"}</td>
                  <td>
                    <span className="est-status-cell">
                      <Badge color={r.flowColor}>{r.flowLabel}</Badge>
                      {canApprove && r.flowKey === "awaiting_approval" && (
                        <ApproveEstimateButton estimateId={r.id} />
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
