"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { JOB_STATUSES, type Job, type JobInput, type Profile } from "@/lib/data/types";
import { createJob, deleteJob, updateJob } from "@/lib/actions/jobs";

function toInput(job?: Job): JobInput {
  return {
    name: job?.name ?? "",
    address: job?.address ?? "",
    status: job?.status ?? "Not Started",
    start_date: job?.start_date ?? "",
    end_date: job?.end_date ?? "",
    assigned_to: job?.assigned_to ?? "",
    notes: job?.notes ?? "",
  };
}

export function JobForm({
  job,
  assignees,
  readOnly,
  onCancel,
  onSaved,
  onDeleted,
}: {
  job?: Job;
  assignees: Profile[];
  readOnly?: boolean;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<JobInput>(toInput(job));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof JobInput>(k: K, v: JobInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.name.trim()) {
      setError("Project name is required.");
      return;
    }
    setPending(true);
    setError("");
    const result = job ? await updateJob(job.id, form) : await createJob(form);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    router.refresh();
    onSaved();
  }

  async function handleDelete() {
    if (!job) return;
    setPending(true);
    const result = await deleteJob(job.id);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    router.refresh();
    onDeleted?.();
  }

  return (
    <Modal title={job ? "Edit Job" : "New Job"} onClose={onCancel}>
      <fieldset disabled={readOnly || pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <Field label="Project Name">
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Kitchen remodel"
            />
          </Field>
          <Field label="Address">
            <input
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Job site address"
            />
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => set("status", e.target.value as JobInput["status"])}>
              {JOB_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assigned To">
            <select
              value={form.assigned_to}
              onChange={(e) => set("assigned_to", e.target.value)}
            >
              <option value="">Unassigned</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.email}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start Date">
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => set("start_date", e.target.value)}
            />
          </Field>
          <Field label="End Date">
            <input
              type="date"
              value={form.end_date}
              onChange={(e) => set("end_date", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
          />
        </Field>

        {error && <p className="error-note">{error}</p>}

        <div className="modal-actions">
          <div className="modal-actions-left">
            {job && !readOnly && (
              <button type="button" className="btn-danger-ghost" onClick={handleDelete}>
                Delete
              </button>
            )}
          </div>
          <div>
            <button type="button" className="btn-ghost" onClick={onCancel}>
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly && (
              <button type="button" className="btn-primary" onClick={handleSave} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </div>
      </fieldset>
    </Modal>
  );
}
