"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import {
  EVENT_TYPES,
  type Event,
  type EventInput,
  type Job,
  type Profile,
} from "@/lib/data/types";
import { createEvent, deleteEvent, updateEvent } from "@/lib/actions/events";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function toInput(event?: Event, initialDate?: string): EventInput {
  return {
    title: event?.title ?? "",
    date: event?.date ?? initialDate ?? todayISO(),
    time: event?.time ?? "09:00",
    event_type: event?.event_type ?? "Estimate",
    assigned_to: event?.assigned_to ?? "",
    job_id: event?.job_id ?? "",
    notes: event?.notes ?? "",
  };
}

export function EventForm({
  event,
  initialDate,
  jobs,
  reps,
  readOnly,
  onCancel,
  onSaved,
  onDeleted,
}: {
  event?: Event;
  initialDate?: string;
  jobs: Job[];
  reps: Profile[];
  readOnly?: boolean;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<EventInput>(toInput(event, initialDate));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof EventInput>(k: K, v: EventInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }
    setPending(true);
    setError("");
    const result = event ? await updateEvent(event.id, form) : await createEvent(form);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    router.refresh();
    onSaved();
  }

  async function handleDelete() {
    if (!event) return;
    setPending(true);
    const result = await deleteEvent(event.id);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    router.refresh();
    onDeleted?.();
  }

  return (
    <Modal title={event ? "Edit Appointment" : "New Appointment"} onClose={onCancel}>
      <fieldset disabled={readOnly || pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <Field label="Title">
            <input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Site visit, estimate walkthrough..."
            />
          </Field>
          <Field label="Type">
            <select
              value={form.event_type}
              onChange={(e) => set("event_type", e.target.value as EventInput["event_type"])}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
          </Field>
          <Field label="Time">
            <input type="time" value={form.time} onChange={(e) => set("time", e.target.value)} />
          </Field>
          <Field label="Assigned To">
            <select value={form.assigned_to} onChange={(e) => set("assigned_to", e.target.value)}>
              <option value="">Unassigned</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || r.email}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Related Job">
            <select value={form.job_id} onChange={(e) => set("job_id", e.target.value)}>
              <option value="">— none —</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Notes">
          <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
        </Field>

        {error && <p className="error-note">{error}</p>}

        <div className="modal-actions">
          <div className="modal-actions-left">
            {event && !readOnly && (
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
