"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setProjectHold } from "@/lib/actions/estimates";
import {
  addProjectChecklistItem,
  applyChecklistTemplate,
  deleteProjectChecklistItem,
  setProjectChecklistItemDone,
} from "@/lib/actions/checklists";
import {
  mapsUrl,
  moneyCents,
  projectTriageOrder,
  type ProjectRollup,
} from "@/lib/data/types";

export type ChecklistItemRow = {
  id: string;
  estimate_id: string;
  label: string;
  sort_order: number;
  completed_at: string | null;
  completed_by: string | null;
};

export type ProjectStatus = "in_progress" | "on_hold" | "complete" | "cancelled";

export type ProjectCard = {
  status: ProjectStatus;
  estimateId: string;
  docNumber: string;
  title: string;
  leadId: string;
  customer: string;
  address: string | null;
  repName: string | null;
  signedAt: string | null;
  changeOrderCount: number;
  rollup: ProjectRollup;
};

type Filter = "All" | "InProgress" | "OnHold" | "Complete" | "Cancelled" | "Bleeding" | "Owed";

const STATUS_TAG: Record<ProjectStatus, string | null> = {
  in_progress: null, // the normal case earns no badge
  on_hold: "On hold",
  complete: "Complete",
  cancelled: "Cancelled",
};

/**
 * Sold jobs, worst first.
 *
 * Sorted by money going the wrong way rather than by name or date:
 * underwater jobs, then the largest amounts owed, then everything else
 * by size. A list ordered any other way is a filing cabinet -- you have
 * to already know which job is in trouble to find out that it is.
 */
export function ProjectsView({
  projects,
  canManage,
  checklistReady,
  checklistItems,
  templates,
  canEditChecklist,
  memberNames,
}: {
  projects: ProjectCard[];
  canManage: boolean;
  checklistReady: boolean;
  checklistItems: ChecklistItemRow[];
  templates: { id: string; name: string; count: number }[];
  canEditChecklist: boolean;
  memberNames: Record<string, string>;
}) {
  const [filter, setFilter] = useState<Filter>("All");
  const [pendingHold, setPendingHold] = useState<string | null>(null);
  const [openChecklist, setOpenChecklist] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const itemsByEstimate = useMemo(() => {
    const map = new Map<string, ChecklistItemRow[]>();
    for (const item of checklistItems) {
      const list = map.get(item.estimate_id) ?? [];
      list.push(item);
      map.set(item.estimate_id, list);
    }
    return map;
  }, [checklistItems]);

  // Cancelled jobs are dead weight: they stay reachable under their own
  // chip, but every figure and every other list on this page speaks only
  // for jobs that are still real. Folding a voided contract into Sold
  // would report money the company is never getting.
  const active = projects.filter((p) => p.status !== "cancelled");
  const cancelled = projects.filter((p) => p.status === "cancelled");

  const sorted = useMemo(
    () => [...active].sort((a, b) => projectTriageOrder(a.rollup, b.rollup)),
    [active]
  );

  const bleeding = sorted.filter((p) => p.rollup.netCashCents < 0);
  const owed = sorted.filter((p) => p.rollup.receivableCents > 0);
  const inProgress = sorted.filter((p) => p.status === "in_progress");
  const onHold = sorted.filter((p) => p.status === "on_hold");
  const complete = sorted.filter((p) => p.status === "complete");
  const shown =
    filter === "Bleeding"
      ? bleeding
      : filter === "Owed"
        ? owed
        : filter === "InProgress"
          ? inProgress
          : filter === "OnHold"
            ? onHold
            : filter === "Complete"
              ? complete
              : filter === "Cancelled"
                ? cancelled
                : sorted;

  const totals = active.reduce(
    (acc, p) => ({
      sold: acc.sold + p.rollup.soldCents,
      collected: acc.collected + p.rollup.collectedCents,
      cost: acc.cost + p.rollup.costCents,
      receivable: acc.receivable + p.rollup.receivableCents,
      net: acc.net + p.rollup.netCashCents,
    }),
    { sold: 0, collected: 0, cost: 0, receivable: 0, net: 0 }
  );

  // Costs nobody can attribute, because the customer has more than one
  // signed contract. Surfaced rather than folded into a job, so the
  // figures above are never quietly wrong.
  //
  // Counted once per customer, not once per project. Every one of a
  // customer's contracts reports the same lead-level figure, so summing
  // the column multiplied it: one $750 receipt on a customer with three
  // contracts was reported as $2,250 of unattributed cost. The totals
  // above were never affected -- they exclude these entirely -- but a
  // warning that overstates the problem is its own kind of wrong.
  const unattributed = [
    ...new Map(
      active
        .filter((p) => p.rollup.unattributedCostCents)
        .map((p) => [p.leadId, p.rollup.unattributedCostCents])
    ).values(),
  ].reduce((s, v) => s + v, 0);

  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-label">No sold jobs yet</p>
        <p className="empty-hint">
          A project appears here the moment a contract is signed. It gathers that contract,
          its change orders, what has been collected and what the job has cost.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-sub">
            {active.length} sold job{active.length === 1 ? "" : "s"} · contract, collected
            and what is left after costs
          </p>
        </div>
      </div>

      <div className="stat-grid stat-grid-5">
        <div className="stat-card">
          <div className="stat-value mono">{moneyCents(totals.sold)}</div>
          <div className="stat-label">Sold</div>
        </div>
        <div className="stat-card">
          <div className="stat-value mono">{moneyCents(totals.collected)}</div>
          <div className="stat-label">Collected</div>
        </div>
        <div className="stat-card">
          <div className="stat-value mono">{moneyCents(totals.receivable)}</div>
          <div className="stat-label">Owed to you</div>
        </div>
        <div className="stat-card">
          <div className="stat-value mono">{moneyCents(totals.cost)}</div>
          <div className="stat-label">Spent</div>
        </div>
        <div className={"stat-card" + (totals.net < 0 ? " digest-urgent" : "")}>
          <div className="stat-value mono">{moneyCents(totals.net)}</div>
          <div className="stat-label">Net cash</div>
        </div>
      </div>

      {bleeding.length > 0 && (
        <div className="dash-panel digest-urgent" style={{ marginBottom: 14 }}>
          <div className="cp-tz-head">
            <span>
              Taking in less than they have cost{" "}
              <span className="count-pill count-pill-urgent">{bleeding.length}</span>
            </span>
          </div>
          <p className="module-sub" style={{ margin: "4px 0 0" }}>
            Collected so far is behind what has been spent. That is normal early on a job and a
            problem late on one &mdash; the phase margins on the contract say which.
          </p>
        </div>
      )}

      {unattributed !== 0 && (
        <p className="hint-note">
          {moneyCents(unattributed)} of costs sit on customers with more than one signed
          contract and are not counted against any single job. File them to a phase on the
          right contract and they will land.
        </p>
      )}

      <div className="chip-row">
        {(
          [
            ["All", `All ${active.length}`, "", active.length],
            ["InProgress", `In progress ${inProgress.length}`, "prog", inProgress.length],
            ["OnHold", `On hold ${onHold.length}`, "hold", onHold.length],
            ["Complete", `Complete ${complete.length}`, "done", complete.length],
            ["Cancelled", `Cancelled ${cancelled.length}`, "dead", cancelled.length],
            ["Bleeding", `Negative net cash ${bleeding.length}`, "bleed", bleeding.length],
            ["Owed", `Owed money ${owed.length}`, "owed", owed.length],
          ] as [Filter, string, string, number][]
        ).map(([f, label, tone, count]) => (
          <button
            key={f}
            // An empty chip stays uncoloured -- colour is a signal that
            // there is something behind the button, so "Cancelled 10"
            // reads louder than "On hold 0" instead of equally loud.
            className={
              "chip" +
              (tone && count > 0 ? ` chip-c-${tone}` : "") +
              (filter === f ? " chip-sel" : "")
            }
            onClick={() => setFilter(f)}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="empty-hint">Nothing here — which is the good outcome.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Customer</th>
                <th className="right">Sold</th>
                <th className="right">Collected</th>
                <th className="right">Owed</th>
                <th className="right">Spent</th>
                <th className="right">Net cash</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const items = itemsByEstimate.get(p.estimateId) ?? [];
                const doneCount = items.filter((i) => i.completed_at).length;
                return (
                <React.Fragment key={p.estimateId}>
                <tr>
                  <td>
                    <Link href={`/estimates/${p.estimateId}`} className="ur-name">
                      {p.title || "Untitled job"}
                    </Link>
                    <div className="est-tax-note">
                      {p.docNumber}
                      {p.changeOrderCount > 0 &&
                        ` · ${p.changeOrderCount} change order${p.changeOrderCount === 1 ? "" : "s"}`}
                      {p.repName && ` · ${p.repName}`}
                      {checklistReady && (items.length > 0 || canEditChecklist) && (
                        <>
                          {" · "}
                          <button
                            type="button"
                            className={
                              "proj-check-chip" +
                              (items.length > 0 && doneCount === items.length
                                ? " proj-check-chip-done"
                                : "")
                            }
                            onClick={() =>
                              setOpenChecklist(
                                openChecklist === p.estimateId ? null : p.estimateId
                              )
                            }
                          >
                            ☑ {items.length > 0 ? `${doneCount}/${items.length}` : "Checklist"}
                          </button>
                        </>
                      )}
                    </div>
                    {(STATUS_TAG[p.status] ||
                      (canManage && p.status !== "complete" && p.status !== "cancelled")) && (
                      <div className="proj-status-line">
                        {STATUS_TAG[p.status] && (
                          <span className={`proj-tag proj-tag-${p.status}`}>
                            {STATUS_TAG[p.status]}
                          </span>
                        )}
                        {canManage && p.status !== "complete" && p.status !== "cancelled" && (
                          <button
                            className="btn-ghost small"
                            disabled={pendingHold === p.estimateId}
                            onClick={() => {
                              setPendingHold(p.estimateId);
                              startTransition(async () => {
                                const res = await setProjectHold(
                                  p.estimateId,
                                  p.status !== "on_hold"
                                );
                                if (res.error) alert(res.error);
                                setPendingHold(null);
                              });
                            }}
                          >
                            {pendingHold === p.estimateId
                              ? "Saving…"
                              : p.status === "on_hold"
                                ? "Resume"
                                : "Put on hold"}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    {p.customer}
                    {p.address && (
                      <div className="est-tax-note">
                        <a href={mapsUrl(p.address)} target="_blank" rel="noopener noreferrer">
                          {p.address}
                        </a>
                      </div>
                    )}
                  </td>
                  <td className="right mono">{moneyCents(p.rollup.soldCents)}</td>
                  <td className="right mono">
                    {moneyCents(p.rollup.collectedCents)}
                    {p.rollup.collectedPct !== null && (
                      <div className="est-tax-note">
                        {p.rollup.collectedPct.toFixed(0)}% of sold
                      </div>
                    )}
                  </td>
                  <td className="right mono">
                    {p.rollup.receivableCents ? moneyCents(p.rollup.receivableCents) : "—"}
                  </td>
                  <td className="right mono">
                    {p.rollup.costCents ? moneyCents(p.rollup.costCents) : "—"}
                  </td>
                  <td className="right mono">
                    {/* Only coloured once something has actually been spent.
                        A job with no costs recorded is not profitable, it is
                        unmeasured, and green would say otherwise. */}
                    {p.rollup.costCents || p.rollup.collectedCents ? (
                      <span className={p.rollup.netCashCents < 0 ? "stale-tag" : ""}>
                        {moneyCents(p.rollup.netCashCents)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
                {openChecklist === p.estimateId && (
                  <tr className="proj-checklist-row">
                    <td colSpan={7}>
                      <ProjectChecklist
                        estimateId={p.estimateId}
                        items={items}
                        templates={templates}
                        canEdit={canEditChecklist}
                        memberNames={memberNames}
                      />
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * The checklist under one project row. Check-off is for anyone who can
 * see this page; changing the list (add, delete, apply a template) is
 * Office/Admin -- the same split the database policies enforce.
 */
function ProjectChecklist({
  estimateId,
  items,
  templates,
  canEdit,
  memberNames,
}: {
  estimateId: string;
  items: ChecklistItemRow[];
  templates: { id: string; name: string; count: number }[];
  canEdit: boolean;
  memberNames: Record<string, string>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [newItem, setNewItem] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState("");

  const refresh = () => startTransition(() => router.refresh());

  async function toggle(item: ChecklistItemRow) {
    setBusy(item.id);
    setError("");
    const result = await setProjectChecklistItemDone(item.id, !item.completed_at);
    setBusy("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    refresh();
  }

  async function add() {
    if (!newItem.trim()) return;
    setBusy("add");
    setError("");
    const result = await addProjectChecklistItem(estimateId, newItem);
    setBusy("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    setNewItem("");
    refresh();
  }

  async function applyTemplate() {
    if (!templateId) return;
    setBusy("template");
    setError("");
    const result = await applyChecklistTemplate(estimateId, templateId);
    setBusy("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    setTemplateId("");
    refresh();
  }

  async function remove(item: ChecklistItemRow) {
    setBusy(item.id);
    setError("");
    const result = await deleteProjectChecklistItem(item.id);
    setBusy("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    refresh();
  }

  return (
    <div className="proj-checklist">
      {items.length === 0 ? (
        <p className="empty-hint" style={{ margin: "2px 0 8px" }}>
          No checklist on this job yet
          {templates.length > 0 ? " — apply a template below or add steps by hand." : "."}
        </p>
      ) : (
        <ul className="proj-checklist-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="proj-check-box"
                onClick={() => toggle(item)}
                disabled={busy === item.id}
                aria-label={item.completed_at ? "Mark not done" : "Mark done"}
              >
                {item.completed_at ? "✓" : "☐"}
              </button>
              <span className={item.completed_at ? "proj-check-done" : undefined}>
                {item.label}
              </span>
              {item.completed_at && (
                <span className="proj-check-meta">
                  {memberNames[item.completed_by ?? ""] || "someone"} ·{" "}
                  {new Date(item.completed_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="icon-btn proj-check-remove"
                  onClick={() => remove(item)}
                  disabled={busy === item.id}
                  aria-label="Remove item"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error-note">{error}</p>}

      {canEdit && (
        <div className="proj-checklist-tools">
          <input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Add a step…"
          />
          <button
            type="button"
            className="btn-ghost small"
            onClick={add}
            disabled={busy === "add" || !newItem.trim()}
          >
            Add
          </button>
          {templates.length > 0 && (
            <>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Apply a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.count})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-ghost small"
                onClick={applyTemplate}
                disabled={busy === "template" || !templateId}
              >
                Apply
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
