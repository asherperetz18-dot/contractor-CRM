"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import {
  EVENT_STATUSES,
  QUICK_TEXT_DEFAULTS,
  fillQuickTextVariables,
  leadDisplayName,
  mapsUrl,
  money,
  type CalendarRow,
  type DocumentRecord,
  type Event,
  type EventInput,
  type EventStatus,
  type Job,
  type Lead,
  type LeadTask,
  type Profile,
  type SmsQuickText,
} from "@/lib/data/types";
import { createEvent, deleteEvent, updateEvent } from "@/lib/actions/events";
import { getQuickTextOptions } from "@/lib/actions/sms-quick-texts";
import { sendSms } from "@/lib/actions/sms";
import { TasksPanel } from "../pipeline/tasks-panel";

type Tab = "Appointment" | "Lead" | "Tasks" | "Estimates" | "Notes";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function friendlyWhen(dateStr: string, timeStr: string): string {
  // event.time comes back from Postgres as "HH:MM:SS"; normalize to "HH:MM"
  // so it isn't ambiguous whether a trailing ":00" is ours or already there.
  const hhmm = timeStr ? timeStr.slice(0, 5) : "00:00";
  const d = new Date(`${dateStr}T${hhmm}:00`);
  if (isNaN(d.getTime())) return dateStr;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const dayLabel = sameDay(d, today)
    ? "today"
    : sameDay(d, tomorrow)
      ? "tomorrow"
      : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeLabel = timeStr
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase()
    : "";
  return timeLabel ? `${dayLabel} at ${timeLabel}` : dayLabel;
}

function toInput(event?: Event, initialDate?: string): EventInput {
  return {
    title: event?.title ?? "",
    date: event?.date ?? initialDate ?? todayISO(),
    time: event?.time ?? "09:00",
    event_type: event?.event_type ?? "Estimate",
    status: event?.status ?? "New",
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
  calendars,
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
  calendars: CalendarRow[];
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
  const [showQuickText, setShowQuickText] = useState(false);
  const [quickTextOptions, setQuickTextOptions] = useState<{
    companyName: string;
    quickTexts: SmsQuickText[];
  } | null>(null);
  const [repTextStatus, setRepTextStatus] = useState<"idle" | "pending" | "sent" | "error">(
    "idle"
  );
  const [repTextError, setRepTextError] = useState("");

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

  function callPhone(phone: string) {
    window.dispatchEvent(
      new CustomEvent("crm:call", { detail: { phone, leadId: lead?.id } })
    );
  }

  function textPhone(phone: string, body?: string) {
    onCancel();
    const params = new URLSearchParams();
    if (lead) params.set("leadId", lead.id);
    else params.set("phone", phone);
    if (body) params.set("body", body);
    router.push(`/reply-inbox?${params.toString()}`);
  }

  async function toggleQuickText() {
    if (!showQuickText && !quickTextOptions) {
      const options = await getQuickTextOptions();
      setQuickTextOptions(options);
    }
    setShowQuickText((v) => !v);
  }

  async function sendRepInfo() {
    const rep = reps.find((r) => r.id === form.assigned_to);
    if (!rep) return;
    if (!rep.phone) {
      setRepTextStatus("error");
      setRepTextError(`${rep.name || rep.email || "This rep"} doesn't have a phone number on file.`);
      return;
    }
    setRepTextStatus("pending");
    setRepTextError("");

    const address = lead?.address || jobs.find((j) => j.id === form.job_id)?.address || null;
    const dateLabel = new Date(`${form.date}T00:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const timeLabel = form.time
      ? new Date(`1970-01-01T${form.time.slice(0, 5)}:00`).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        })
      : "";
    const lines = [
      `Appointment: ${form.title || "Untitled"}`,
      `📅 ${dateLabel}${timeLabel ? ` at ${timeLabel}` : ""}`,
    ];
    if (address) lines.push(`📍 ${mapsUrl(address)}`);

    const result = await sendSms(null, rep.phone, lines.join("\n"));
    if (result?.error) {
      setRepTextStatus("error");
      setRepTextError(result.error);
      return;
    }
    setRepTextStatus("sent");
    setTimeout(() => setRepTextStatus("idle"), 2500);
  }

  function sendQuickText(text: SmsQuickText) {
    if (!lead?.phone || !quickTextOptions) return;
    const repName = reps.find((r) => r.id === form.assigned_to)?.name ?? "";
    const filled = fillQuickTextVariables(text.body || QUICK_TEXT_DEFAULTS[text.key], {
      firstName: lead.first_name ?? "",
      when: friendlyWhen(form.date, form.time),
      repName,
      companyName: quickTextOptions.companyName,
    });
    setShowQuickText(false);
    textPhone(lead.phone, filled);
  }

  return (
    <Modal title={event ? "Edit Appointment" : "New Appointment"} onClose={onCancel} wide>
      {lead && (
        <div className="contact-card">
          <div className="contact-card-name">{leadDisplayName(lead)}</div>
          {lead.address && (
            <div className="contact-card-line">
              📍{" "}
              <a href={mapsUrl(lead.address)} target="_blank" rel="noopener noreferrer">
                {lead.address}
              </a>
            </div>
          )}
          {lead.phone && (
            <div className="contact-card-line contact-card-actions-row">
              <span>☎ {lead.phone}</span>
              <button
                type="button"
                className="icon-btn contact-quick-action"
                onClick={() => callPhone(lead.phone!)}
                title="Call"
                aria-label="Call"
              >
                📞
              </button>
              <button
                type="button"
                className="icon-btn contact-quick-action"
                onClick={() => textPhone(lead.phone!)}
                title="Text"
                aria-label="Text"
              >
                💬
              </button>
              <div className="quick-text-wrap">
                <button
                  type="button"
                  className="icon-btn contact-quick-action"
                  onClick={toggleQuickText}
                  title="Quick Text"
                  aria-label="Quick Text"
                >
                  Quick Text ▾
                </button>
                {showQuickText && (
                  <div className="quick-text-menu">
                    {quickTextOptions === null ? (
                      <div className="quick-text-item quick-text-loading">Loading…</div>
                    ) : (
                      quickTextOptions.quickTexts.map((text) => (
                        <button
                          key={text.key}
                          type="button"
                          className="quick-text-item"
                          onClick={() => sendQuickText(text)}
                        >
                          {text.label}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
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
            <Field label="Calendar">
              <select
                value={form.event_type}
                onChange={(e) => set("event_type", e.target.value)}
              >
                {calendars.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => set("status", e.target.value as EventStatus)}
              >
                {EVENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
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
              {form.assigned_to && (
                <div className="rep-text-row">
                  <button
                    type="button"
                    className="btn-ghost small"
                    onClick={sendRepInfo}
                    disabled={repTextStatus === "pending"}
                  >
                    {repTextStatus === "pending" ? "Sending…" : "📲 Text Rep Info"}
                  </button>
                  {repTextStatus === "sent" && <span className="cp-saved">✓ Sent</span>}
                </div>
              )}
              {repTextStatus === "error" && <p className="error-note">{repTextError}</p>}
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
