"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { leadDisplayName, money, type Lead, type Profile } from "@/lib/data/types";
import { resolveLeadRefund } from "@/lib/actions/leads";

type StatusFilter = "All" | "Requested" | "Received" | "Denied";

const STATUS_COLOR: Record<string, string> = {
  Requested: "#C7691B",
  Received: "#2F855A",
  Denied: "#C0392B",
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote whenever the value could otherwise break the column structure.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function LeadRefundsView({
  leads,
  reps,
  canWrite,
}: {
  leads: Lead[];
  reps: Profile[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const repName = useMemo(
    () => new Map(reps.map((r) => [r.id, r.name || r.email || "—"])),
    [reps]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (statusFilter !== "All" && l.refund_status !== statusFilter) return false;
      if (!q) return true;
      return (
        leadDisplayName(l).toLowerCase().includes(q) ||
        (l.source || "").toLowerCase().includes(q) ||
        (l.phone || "").toLowerCase().includes(q)
      );
    });
  }, [leads, statusFilter, search]);

  const sum = (list: Lead[]) => list.reduce((t, l) => t + (Number(l.lead_cost) || 0), 0);
  const requested = leads.filter((l) => l.refund_status === "Requested");
  const received = leads.filter((l) => l.refund_status === "Received");
  const denied = leads.filter((l) => l.refund_status === "Denied");
  const missingCost = leads.filter((l) => !Number(l.lead_cost)).length;

  async function resolve(id: string, status: "Received" | "Denied") {
    setBusyId(id);
    setError("");
    const result = await resolveLeadRefund(id, status);
    setBusyId("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  function downloadCsv() {
    const header = [
      "Contact",
      "Phone",
      "Email",
      "Source",
      "Lead Cost",
      "Stage",
      "Assigned Rep",
      "Refund Status",
      "Requested On",
      "Days Open",
    ];
    const lines = [header.join(",")];
    for (const l of rows) {
      const d = daysSince(l.refund_requested_at);
      lines.push(
        [
          csvCell(leadDisplayName(l)),
          csvCell(l.phone),
          csvCell(l.email),
          csvCell(l.source),
          csvCell(Number(l.lead_cost) || 0),
          csvCell(l.stage),
          csvCell(l.assigned_to ? repName.get(l.assigned_to) : ""),
          csvCell(l.refund_status),
          csvCell(l.refund_requested_at ? l.refund_requested_at.slice(0, 10) : ""),
          csvCell(l.refund_status === "Requested" && d !== null ? d : ""),
        ].join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lead-refunds-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Lead Refunds</h1>
          <p className="module-sub">
            Refunds requested from lead vendors — what&apos;s outstanding, what came back
          </p>
        </div>
        <button className="btn-ghost" onClick={downloadCsv} disabled={rows.length === 0}>
          ⭳ Download CSV
        </button>
      </div>

      <div className="stat-grid">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{requested.length}</div>
          <div className="stat-label">Awaiting Refund</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{money(sum(requested))}</div>
          <div className="stat-label">Value Outstanding</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{money(sum(received))}</div>
          <div className="stat-label">Recovered</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{denied.length}</div>
          <div className="stat-label">Denied</div>
        </div>
      </div>

      {/* The dollar figures above are only as good as the lead cost on each
          record, so say plainly when most of them are blank rather than
          letting the totals read as complete. */}
      {missingCost > 0 && (
        <p className="hint-note" style={{ marginTop: 0 }}>
          {missingCost} of {leads.length} of these have no Lead Cost recorded, so they count toward
          the totals as $0. Fill in Lead Cost on the contact for the dollar figures to be accurate.
        </p>
      )}

      <div className="filter-bar">
        <input
          className="ur-search"
          style={{ maxWidth: 300, marginBottom: 0 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone, or source…"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="All">All statuses</option>
          <option value="Requested">Awaiting refund</option>
          <option value="Received">Received</option>
          <option value="Denied">Denied</option>
        </select>
      </div>

      {error && <p className="error-note">{error}</p>}

      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">Nothing to show</p>
          <p className="empty-hint">
            Refunds requested from a contact&apos;s card appear here so you can chase them and
            record the outcome.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Source</th>
                <th className="right">Lead Cost</th>
                <th>Requested</th>
                <th className="right">Days Open</th>
                <th>Status</th>
                {canWrite && <th>Outcome</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const d = daysSince(l.refund_requested_at);
                const stale = l.refund_status === "Requested" && d !== null && d >= 30;
                return (
                  <tr key={l.id}>
                    <td>
                      {leadDisplayName(l)}
                      <div className="ai-proposal-count">{l.phone || l.email || "—"}</div>
                    </td>
                    <td>{l.source || "—"}</td>
                    <td className="right mono">
                      {Number(l.lead_cost) ? money(Number(l.lead_cost)) : "—"}
                    </td>
                    <td>
                      {l.refund_requested_at
                        ? new Date(l.refund_requested_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="right mono">
                      {l.refund_status === "Requested" && d !== null ? (
                        <span className={stale ? "refund-stale" : ""}>{d}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <Badge color={STATUS_COLOR[l.refund_status] || "#7C8798"}>
                        {l.refund_status}
                      </Badge>
                    </td>
                    {canWrite && (
                      <td>
                        {l.refund_status === "Requested" ? (
                          <div className="ai-proposal-actions">
                            <button
                              type="button"
                              className="btn-primary small"
                              disabled={busyId === l.id}
                              onClick={() => resolve(l.id, "Received")}
                            >
                              Received
                            </button>
                            <button
                              type="button"
                              className="btn-ghost small"
                              disabled={busyId === l.id}
                              onClick={() => resolve(l.id, "Denied")}
                            >
                              Denied
                            </button>
                          </div>
                        ) : (
                          <span className="ai-proposal-count">Closed</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
