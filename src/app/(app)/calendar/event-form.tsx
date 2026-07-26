"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import {
  EVENT_TYPES,
  leadDisplayName,
  money,
  type DocumentRecord,
  type Event,
  type EventInput,
  type Job,
  type Lead,
  type LeadTask,
  type Profile,
} from "@/lib/data/types";
import { createEvent, deleteEvent, updateEvent } from "@/lib/actions/events";
import { TasksPanel } from "../pipeline/tasks-panel";

type Tab = "Appointment" | "Lead" | "Tasks" | "Estimates" | "Notes";

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
    customer_confirmed: event?.customer_confirmed ?? false,
    rep_confirmed: event?.rep_confirmed ?? false,
  };
}

export function EventForm({
  event,
  initialDate,
  jobs,
  reps,
  leads,
  leadTasks,
  documents,
  readOnly,
  onCancel,
  onSaved,
  onDeleted,
}: {
  event?: Event;
  initialDate?: string;
  jobs: Job[];
  reps: Profile[];
  leads?: Lead[];
  leadTasks?: LeadTask[];
  documents?: DocumentRecord[];
  readOnly?: boolean;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<EventInput>(toInput(event, initialDate));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("Appointment");

  const lead = event?.lead_id ? leads?.find((l) => l.id === event.lead_id) ?? null : null;
  const linkedTasks = lead ? (leadTasks ?? []).filter((t) => t.lead_id === lead.id) : [];
  const openTaskCount = linkedTasks.filter((t) => !t.completed_at).length;
  const linkedEstimates = lead
    ? (documents ?? []).filter((d) => d.contact_id === lead.id)
    : [];

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

  function openFullLead() {
    if (!lead) return;
    onCancel();
    router.push(`/contacts?openLead=${lead.id}`);
  }

  return (
    <Modal title={event ? "Edit Appointment" : "New Appointment"} onClose={onCancel} wide>
      {lead && (
        <div className="contact-card">
          <div className="contact-card-name">{leadDisplayName(lead)}</div>
          {lead.address && <div className="contact-card-line">📍 {lead.address}</div>}
          {lead.phone && <div className="contact-card-line">☎ {lead.phone}</div>}
          {lead.email && <div className="contact-card-line">✉ {lead.email}</div>}
          {lead.source && <div className="contact-card-line">Source: {lead.source}</div>}
        </div>
      )}

      {lead && (
        <div className="chip-row no-margin ta-tabs">
          {(["Appointment", "Lead", "Tasks", "Estimates", "Notes"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={"chip" + (tab === t ? " chip-active" : "")}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "Tasks" && openTaskCount > 0 ? ` (${openTaskCount})` : ""}
              {t === "Estimates" && linkedEstimates.length > 0
                ? ` (${linkedEstimates.length})`
                : ""}
            </button>
          ))}
        </div>
      )}

      {(!lead || tab === "Appointment") && (
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

          <div className="form-grid">
            <Field label="Customer">
              <button
                type="button"
                className="confirm-toggle"
                onClick={() => set("customer_confirmed", !form.customer_confirmed)}
                disabled={readOnly || pending}
              >
                <Badge color={form.customer_confirmed ? "#2F855A" : "#C7691B"}>
                  {form.customer_confirmed ? "Confirmed" : "Unconfirmed"}
                </Badge>
              </button>
            </Field>
            <Field label="Rep Confirmation">
              <button
                type="button"
                className="confirm-toggle"
                onClick={() => set("rep_confirmed", !form.rep_confirmed)}
                disabled={readOnly || pending}
              >
                <Badge color={form.rep_confirmed ? "#2F855A" : "#C7691B"}>
                  {form.rep_confirmed ? "Confirmed" : "Unconfirmed"}
                </Badge>
              </button>
            </Field>
          </div>

          {!lead && (
            <Field label="Notes">
              <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
            </Field>
          )}
        </fieldset>
      )}

      {lead && tab === "Lead" && (
        <div>
          <div className="form-grid">
            <Field label="Project Type">
              <div className="ta-readonly-value">{lead.project_type || "—"}</div>
            </Field>
            <Field label="Stage">
              <div className="ta-readonly-value">{lead.stage}</div>
            </Field>
            <Field label="Value">
              <div className="ta-readonly-value">{money(lead.value)}</div>
            </Field>
            <Field label="Source">
              <div className="ta-readonly-value">{lead.source || "—"}</div>
            </Field>
          </div>
          {lead.notes && (
            <Field label="Lead Notes">
              <div className="hint-note">{lead.notes}</div>
            </Field>
          )}
          <div className="modal-actions">
            <div />
            <div>
              <button type="button" className="btn-primary" onClick={openFullLead}>
                Open Full Lead
              </button>
            </div>
          </div>
        </div>
      )}

      {lead && tab === "Tasks" && (
        <TasksPanel
          leadId={lead.id}
          tasks={linkedTasks}
          reps={reps}
          readOnly={readOnly}
          onChanged={() => router.refresh()}
        />
      )}

      {lead && tab === "Estimates" && (
        <div>
          {linkedEstimates.length === 0 ? (
            <p className="empty-hint">No estimates yet for this lead.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th className="right">Total</th>
                </tr>
              </thead>
              <tbody>
                {linkedEstimates.map((d) => (
                  <tr key={d.id}>
                    <td>{d.date}</td>
                    <td>
                      <Badge color="#2D5F8A">{d.status}</Badge>
                    </td>
                    <td className="right mono">
                      {money(d.items.reduce((s, i) => s + i.qty * i.price, 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {lead && tab === "Notes" && (
        <Field label="Appointment Notes">
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={6}
            disabled={readOnly || pending}
          />
        </Field>
      )}

      {(!lead || tab !== "Lead") && (
        <>
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
        </>
      )}
    </Modal>
  );
}
