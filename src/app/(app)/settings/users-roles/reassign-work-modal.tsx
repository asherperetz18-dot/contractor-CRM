"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import type { Profile } from "@/lib/data/types";
import {
  getAssignedWork,
  reassignWork,
  type ReassignScope,
  type WorkCounts,
} from "@/lib/actions/reassign-work";

export type ReassignMode = "remove" | "archive" | "standalone";

const TITLES: Record<ReassignMode, string> = {
  remove: "Remove from company",
  archive: "Archive user",
  standalone: "Reassign work",
};

function totalOpen(c: WorkCounts) {
  return c.openLeads + c.upcomingAppointments + c.openTasks;
}
function totalAll(c: WorkCounts) {
  return (
    c.openLeads +
    c.closedLeads +
    c.upcomingAppointments +
    c.pastAppointments +
    c.openTasks +
    c.completedTasks
  );
}

export function ReassignWorkModal({
  user,
  others,
  mode,
  onCancel,
  onConfirmed,
}: {
  user: Profile;
  others: Profile[];
  mode: ReassignMode;
  /** Runs after the handover succeeds -- removal/archiving happens there. */
  onCancel: () => void;
  onConfirmed: () => void | Promise<void>;
}) {
  const [counts, setCounts] = useState<WorkCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState("");
  const [scope, setScope] = useState<ReassignScope>("open");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getAssignedWork(user.id);
      if (cancelled) return;
      if (result.error) setError(result.error);
      setCounts(result.counts ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const name = user.name || user.email || "This user";
  const hasWork = counts ? totalAll(counts) > 0 : false;

  async function confirm() {
    setPending(true);
    setError("");

    if (hasWork) {
      const result = await reassignWork(user.id, target || null, scope);
      if (result.error) {
        setPending(false);
        setError(result.error);
        return;
      }
    }
    await onConfirmed();
    setPending(false);
  }

  return (
    <Modal title={TITLES[mode]} onClose={onCancel}>
      {loading ? (
        <p className="empty-hint">Checking what {name} owns…</p>
      ) : !hasWork ? (
        <p className="empty-hint">
          {name} has no leads, appointments or tasks assigned. Nothing to hand over.
        </p>
      ) : (
        <>
          <p className="empty-hint" style={{ marginTop: 0 }}>
            {name} currently owns:
          </p>
          <ul className="rw-counts">
            <li>
              <strong>{counts!.openLeads}</strong> open lead
              {counts!.openLeads === 1 ? "" : "s"}
              {counts!.closedLeads > 0 && <span> · {counts!.closedLeads} closed</span>}
            </li>
            <li>
              <strong>{counts!.upcomingAppointments}</strong> upcoming appointment
              {counts!.upcomingAppointments === 1 ? "" : "s"}
              {counts!.pastAppointments > 0 && <span> · {counts!.pastAppointments} past</span>}
            </li>
            <li>
              <strong>{counts!.openTasks}</strong> open task
              {counts!.openTasks === 1 ? "" : "s"}
              {counts!.completedTasks > 0 && <span> · {counts!.completedTasks} completed</span>}
            </li>
          </ul>

          <Field label="Hand the work to">
            <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={pending}>
              <option value="">— Leave unassigned —</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name || o.email}
                </option>
              ))}
            </select>
          </Field>

          <Field label="How much">
            <label className="rw-choice">
              <input
                type="radio"
                name="rw-scope"
                checked={scope === "open"}
                onChange={() => setScope("open")}
                disabled={pending}
              />
              <span>
                <strong>Open work only</strong> ({totalOpen(counts!)} item
                {totalOpen(counts!) === 1 ? "" : "s"}) — closed leads, past appointments and
                completed tasks keep {name}&apos;s name, so your reporting still credits the
                right person.
              </span>
            </label>
            <label className="rw-choice">
              <input
                type="radio"
                name="rw-scope"
                checked={scope === "all"}
                onChange={() => setScope("all")}
                disabled={pending}
              />
              <span>
                <strong>Everything</strong> ({totalAll(counts!)} items) — history moves too. The
                new owner will be credited with deals {name} closed.
              </span>
            </label>
          </Field>
        </>
      )}

      {error && <p className="error-note">{error}</p>}

      <div className="modal-actions">
        <div />
        <div>
          <button type="button" className="btn-ghost small" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className={mode === "standalone" ? "btn-primary small" : "btn-danger-ghost small"}
            onClick={confirm}
            disabled={pending || loading}
          >
            {pending
              ? "Working…"
              : mode === "remove"
                ? "Reassign & remove"
                : mode === "archive"
                  ? "Reassign & archive"
                  : "Reassign"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
