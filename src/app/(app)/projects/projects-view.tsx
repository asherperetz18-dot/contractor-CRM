"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { setProjectHold } from "@/lib/actions/estimates";
import { mapsUrl, moneyCents, projectTriageOrder, type ProjectRollup } from "@/lib/data/types";
import { Modal } from "@/components/ui/modal";
import { AddBillModal, jobOptionsFromProjects } from "@/components/bills/add-bill-modal";
import { JobPhotos } from "./job-photos";
import { JobReceipts } from "./job-receipts";
import { JobDocuments } from "./job-documents";
import { ProjectChecklist, type ChecklistItemRow } from "./project-checklist";

export type { ChecklistItemRow } from "./project-checklist";

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
  /** The contract's child documents, for the client-view shortcuts. */
  changeOrders: { id: string; docNumber: string; title: string | null }[];
  rollup: ProjectRollup;
  /** Bills on this job that are not paid yet. Not part of Spent -- the
   *  money hasn't left -- but shown beside it so an open bill is never
   *  invisible on the job. */
  unpaidBillsCents: number;
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
  canAddCosts,
  canBills,
  canUploadPhotos,
  canSeeDocChips,
  canFileDocs,
  checklistReady,
  checklistItems,
  templates,
  canEditChecklist,
  canRemoveChecklist,
  memberNames,
}: {
  projects: ProjectCard[];
  canManage: boolean;
  canAddCosts: boolean;
  /** May file an unpaid bill (Bookkeeping, Office, Admin). */
  canBills: boolean;
  canUploadPhotos: boolean;
  /** The document shortcuts: receipts list, client-view contract and
   *  change orders. Office, Admin and Production -- never Field. */
  canSeeDocChips: boolean;
  /** Moving files between jobs: Office/Admin/Production. */
  canFileDocs: boolean;
  checklistReady: boolean;
  checklistItems: ChecklistItemRow[];
  templates: { id: string; name: string; count: number }[];
  canEditChecklist: boolean;
  canRemoveChecklist: boolean;
  memberNames: Record<string, string>;
}) {
  const [filter, setFilter] = useState<Filter>("All");
  const [pendingHold, setPendingHold] = useState<string | null>(null);
  const [openChecklist, setOpenChecklist] = useState<string | null>(null);
  // Which job the bill modal opens on: a lead id from a row's chip,
  // "any" from the page-level button, null when closed.
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const [photosFor, setPhotosFor] = useState<{ leadId: string; estimateId: string; label: string } | null>(null);
  const [receiptsFor, setReceiptsFor] = useState<{ leadId: string; label: string } | null>(null);
  const [changeOrdersFor, setChangeOrdersFor] = useState<ProjectCard | null>(null);
  const [documentsFor, setDocumentsFor] = useState<{ leadId: string; estimateId: string; label: string } | null>(null);
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

  // The money cards follow the selected chip: pick "Complete" and the
  // figures speak for finished work; pick "Cancelled" and Sold becomes
  // "how much business fell through". The chip itself names the scope.
  const totals = shown.reduce(
    (acc, p) => ({
      sold: acc.sold + p.rollup.soldCents,
      collected: acc.collected + p.rollup.collectedCents,
      cost: acc.cost + p.rollup.costCents,
      receivable: acc.receivable + p.rollup.receivableCents,
      net: acc.net + p.rollup.netCashCents,
      unpaid: acc.unpaid + p.unpaidBillsCents,
    }),
    { sold: 0, collected: 0, cost: 0, receivable: 0, net: 0, unpaid: 0 }
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
        {canAddCosts && (
          <button className="btn-primary" onClick={() => setReceiptFor("any")}>
            + Add bill
          </button>
        )}
      </div>

      {receiptFor && (
        <AddBillModal
          jobs={jobOptionsFromProjects(sorted)}
          initialLeadId={receiptFor === "any" ? "" : receiptFor}
          canBills={canBills}
          defaultPaid
          onClose={() => setReceiptFor(null)}
        />
      )}
      {photosFor && (
        <JobPhotos
          leadId={photosFor.leadId}
          estimateId={photosFor.estimateId}
          jobLabel={photosFor.label}
          canUpload={canUploadPhotos}
          canFile={canFileDocs}
          onClose={() => setPhotosFor(null)}
        />
      )}
      {receiptsFor && (
        <JobReceipts
          leadId={receiptsFor.leadId}
          jobLabel={receiptsFor.label}
          onClose={() => setReceiptsFor(null)}
        />
      )}
      {documentsFor && (
        <JobDocuments
          leadId={documentsFor.leadId}
          estimateId={documentsFor.estimateId}
          jobLabel={documentsFor.label}
          canFile={canFileDocs}
          onClose={() => setDocumentsFor(null)}
        />
      )}
      {changeOrdersFor && (
        <Modal
          title={`Change orders — ${changeOrdersFor.customer}`}
          onClose={() => setChangeOrdersFor(null)}
        >
          <ul className="co-link-list">
            {changeOrdersFor.changeOrders.map((co) => (
              <li key={co.id}>
                <a href={`/estimates/${co.id}/preview`} target="_blank" rel="noopener noreferrer">
                  👁 {co.docNumber}
                  {co.title ? ` · ${co.title}` : ""}
                </a>
              </li>
            ))}
          </ul>
        </Modal>
      )}

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
          {totals.unpaid > 0 && (
            <div className="est-tax-note">+ {moneyCents(totals.unpaid)} in unpaid bills</div>
          )}
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
                      {canAddCosts && p.status !== "cancelled" && (
                        <>
                          {" · "}
                          {/* Straight into the modal with THIS job picked --
                              the receipt is in one hand, the job is on this
                              row, nobody re-answers a question the screen
                              already knows. */}
                          <button
                            type="button"
                            className="proj-check-chip proj-receipt-chip"
                            onClick={() => setReceiptFor(p.leadId)}
                          >
                            🧾 + Bill
                          </button>
                        </>
                      )}
                      {" · "}
                      <button
                        type="button"
                        className="proj-check-chip proj-photo-chip"
                        onClick={() => setPhotosFor({ leadId: p.leadId, estimateId: p.estimateId, label: p.customer })}
                      >
                        📷 Photos
                      </button>
                      {canSeeDocChips && (
                        <>
                          {" · "}
                          <button
                            type="button"
                            className="proj-check-chip proj-doc-chip"
                            onClick={() =>
                              setReceiptsFor({ leadId: p.leadId, label: p.customer })
                            }
                          >
                            🧾 Bills
                          </button>
                          {" · "}
                          {/* The customer's copy, one click away -- the same
                              preview-as-customer render the portal serves. */}
                          <a
                            className="proj-check-chip proj-doc-chip"
                            href={`/estimates/${p.estimateId}/preview`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            👁 Contract
                          </a>
                          {p.changeOrders.length === 1 && (
                            <>
                              {" · "}
                              <a
                                className="proj-check-chip proj-doc-chip"
                                href={`/estimates/${p.changeOrders[0].id}/preview`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                👁 Change order
                              </a>
                            </>
                          )}
                          {p.changeOrders.length > 1 && (
                            <>
                              {" · "}
                              <button
                                type="button"
                                className="proj-check-chip proj-doc-chip"
                                onClick={() => setChangeOrdersFor(p)}
                              >
                                👁 Change orders ({p.changeOrders.length})
                              </button>
                            </>
                          )}
                          {" · "}
                          <button
                            type="button"
                            className="proj-check-chip proj-doc-chip"
                            onClick={() =>
                              setDocumentsFor({ leadId: p.leadId, estimateId: p.estimateId, label: p.customer })
                            }
                          >
                            📄 Permits &amp; contracts
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
                    {p.unpaidBillsCents > 0 && (
                      <div className="est-tax-note">+ {moneyCents(p.unpaidBillsCents)} unpaid</div>
                    )}
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
                        canRemove={canRemoveChecklist}
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
