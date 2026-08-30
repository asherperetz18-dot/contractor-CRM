"use client";

import { useMemo, useState } from "react";
import { mapsUrl } from "@/lib/data/types";
import { QuickReceipt } from "./quick-receipt";
import { JobPhotos } from "./job-photos";
import { ProjectChecklist, type ChecklistItemRow } from "./project-checklist";

export type CrewJob = {
  estimateId: string;
  docNumber: string;
  title: string;
  leadId: string;
  customer: string;
  address: string | null;
  status: "in_progress" | "on_hold" | "complete";
};

/**
 * The Projects page as the crew sees it: which jobs are running, what's
 * on each job's checklist, and two buttons -- receipt and photos.
 *
 * There is deliberately no dollar figure anywhere in this component's
 * props. The server builds this view from a query that never selects a
 * money column, so the crew's page doesn't hide the numbers, it simply
 * never receives them.
 */
export function CrewProjectsView({
  jobs,
  checklistItems,
  memberNames,
}: {
  jobs: CrewJob[];
  checklistItems: ChecklistItemRow[];
  memberNames: Record<string, string>;
}) {
  const [openChecklist, setOpenChecklist] = useState<string | null>(null);
  // A lead id from a row's button, "any" from the page-level one.
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const [photosFor, setPhotosFor] = useState<{ leadId: string; label: string } | null>(null);

  const itemsByEstimate = useMemo(() => {
    const map = new Map<string, ChecklistItemRow[]>();
    for (const item of checklistItems) {
      const list = map.get(item.estimate_id) ?? [];
      list.push(item);
      map.set(item.estimate_id, list);
    }
    return map;
  }, [checklistItems]);

  const active = jobs.filter((j) => j.status !== "complete");
  const finished = jobs.filter((j) => j.status === "complete");

  const card = (j: CrewJob) => {
    const items = itemsByEstimate.get(j.estimateId) ?? [];
    const doneCount = items.filter((i) => i.completed_at).length;
    return (
      <div key={j.estimateId} className="crew-card">
        <div className="crew-card-head">
          <span className="ur-name">{j.title || "Untitled job"}</span>
          {j.status === "on_hold" && <span className="proj-tag proj-tag-on_hold">On hold</span>}
          {j.status === "complete" && <span className="proj-tag proj-tag-complete">Complete</span>}
        </div>
        <div className="est-tax-note">
          {j.docNumber} · {j.customer}
        </div>
        {j.address && (
          <div className="est-tax-note">
            <a href={mapsUrl(j.address)} target="_blank" rel="noopener noreferrer">
              {j.address}
            </a>
          </div>
        )}
        <div className="crew-card-actions">
          {items.length > 0 && (
            <button
              type="button"
              className={
                "proj-check-chip" +
                (doneCount === items.length ? " proj-check-chip-done" : "")
              }
              onClick={() =>
                setOpenChecklist(openChecklist === j.estimateId ? null : j.estimateId)
              }
            >
              ☑ {doneCount}/{items.length}
            </button>
          )}
          {j.status !== "complete" && (
            <button
              type="button"
              className="proj-check-chip proj-receipt-chip"
              onClick={() => setReceiptFor(j.leadId)}
            >
              🧾 + Receipt
            </button>
          )}
          <button
            type="button"
            className="proj-check-chip proj-photo-chip"
            onClick={() =>
              setPhotosFor({ leadId: j.leadId, label: j.customer })
            }
          >
            📷 Photos
          </button>
        </div>
        {openChecklist === j.estimateId && (
          <ProjectChecklist
            estimateId={j.estimateId}
            items={items}
            templates={[]}
            canEdit={false}
            memberNames={memberNames}
          />
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
          <p className="module-sub">
            Your running jobs — snap receipts, add photos, check off the plan.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setReceiptFor("any")}>
          + Receipt
        </button>
      </div>

      {active.length === 0 ? (
        <p className="empty-hint">No jobs running right now.</p>
      ) : (
        active.map(card)
      )}

      {finished.length > 0 && (
        <details className="crew-finished">
          <summary>Finished jobs ({finished.length})</summary>
          {finished.map(card)}
        </details>
      )}

      {receiptFor && (
        <QuickReceipt
          projects={jobs}
          initialLeadId={receiptFor === "any" ? undefined : receiptFor}
          onClose={() => setReceiptFor(null)}
        />
      )}
      {photosFor && (
        <JobPhotos
          leadId={photosFor.leadId}
          jobLabel={photosFor.label}
          canUpload
          onClose={() => setPhotosFor(null)}
        />
      )}
    </div>
  );
}
