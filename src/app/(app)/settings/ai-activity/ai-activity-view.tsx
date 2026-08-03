"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AI_ACTION_LABEL, type ProposalStatus } from "@/lib/data/ai-proposals";
import type { Profile } from "@/lib/data/types";

export type AiActivityRow = {
  id: string;
  action_type: string;
  summary: string;
  target_count: number;
  status: ProposalStatus;
  result: { changed?: number; skipped?: number } | null;
  error: string | null;
  created_at: string;
  decided_at: string | null;
  proposed_by: string | null;
  decided_by: string | null;
};

const STATUS_COLOR: Record<ProposalStatus, string> = {
  pending: "#C7691B",
  applied: "#2F855A",
  rejected: "#7C8798",
  failed: "#C0392B",
};

const STATUS_LABEL: Record<ProposalStatus, string> = {
  pending: "Awaiting approval",
  applied: "Applied",
  rejected: "Dismissed",
  failed: "Failed",
};

export function AiActivityView({
  rows,
  members,
  notReady,
}: {
  rows: AiActivityRow[];
  members: Profile[];
  notReady: boolean;
}) {
  const [statusFilter, setStatusFilter] = useState<"All" | ProposalStatus>("All");

  const nameById = useMemo(
    () => new Map(members.map((m) => [m.id, m.name || m.email || "Unknown"])),
    [members]
  );

  const filtered = useMemo(
    () => (statusFilter === "All" ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter]
  );

  const applied = rows.filter((r) => r.status === "applied");
  const recordsChanged = applied.reduce((sum, r) => sum + (r.result?.changed ?? 0), 0);

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">AI Activity Log</h1>
          <p className="module-sub">
            Every change the AI assistant suggested, who decided on it, and what it actually changed
          </p>
        </div>
      </div>

      {notReady ? (
        <div className="empty-state">
          <p className="empty-label">Not set up yet</p>
          <p className="empty-hint">
            The AI suggestion log needs database migration 0043 to be run. Until then the assistant
            still answers questions, but it can&apos;t record suggestions for approval.
          </p>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card stat-static">
              <div className="stat-value mono">{rows.length}</div>
              <div className="stat-label">Suggestions</div>
            </div>
            <div className="stat-card stat-static">
              <div className="stat-value mono">{applied.length}</div>
              <div className="stat-label">Approved</div>
            </div>
            <div className="stat-card stat-static">
              <div className="stat-value mono">
                {rows.filter((r) => r.status === "rejected").length}
              </div>
              <div className="stat-label">Dismissed</div>
            </div>
            <div className="stat-card stat-static">
              <div className="stat-value mono">{recordsChanged}</div>
              <div className="stat-label">Records Changed</div>
            </div>
          </div>

          <div className="filter-bar">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "All" | ProposalStatus)}
            >
              <option value="All">All statuses</option>
              <option value="pending">Awaiting approval</option>
              <option value="applied">Applied</option>
              <option value="rejected">Dismissed</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state">
              <p className="empty-label">Nothing logged yet</p>
              <p className="empty-hint">
                When the assistant suggests a change, it appears here with its outcome — nothing is
                ever applied without someone approving it first.
              </p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Suggestion</th>
                    <th>Status</th>
                    <th>Decided by</th>
                    <th className="right">Changed</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.created_at).toLocaleString()}</td>
                      <td>{AI_ACTION_LABEL[r.action_type] || r.action_type}</td>
                      <td style={{ maxWidth: 380 }}>
                        {r.summary}
                        {r.error && <div className="error-note">{r.error}</div>}
                      </td>
                      <td>
                        <Badge color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      </td>
                      <td>
                        {r.decided_by ? nameById.get(r.decided_by) || "Unknown" : "—"}
                        {r.decided_at && (
                          <div className="ai-proposal-count">
                            {new Date(r.decided_at).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td className="right mono">
                        {r.status === "applied"
                          ? `${r.result?.changed ?? 0}${
                              r.result?.skipped ? ` (+${r.result.skipped} skipped)` : ""
                            }`
                          : `${r.target_count} proposed`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
