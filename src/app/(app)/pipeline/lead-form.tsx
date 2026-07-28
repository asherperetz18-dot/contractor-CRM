"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { TimeField } from "@/components/ui/time-field";
import { AddressAutocompleteInput } from "@/components/ui/address-autocomplete-input";
import {
  leadDisplayName,
  mapsUrl,
  money,
  stageColor,
  type CalendarRow,
  type Lead,
  type LeadFile,
  type LeadInput,
  type LeadNote,
  type LeadTask,
  type PipelineStageRow,
  type Profile,
  type RefundStatus,
} from "@/lib/data/types";
import {
  bookAppointmentForLead,
  convertLeadToJob,
  createLead,
  deleteLead,
  requestLeadRefund,
  resolveLeadRefund,
  updateLead,
} from "@/lib/actions/leads";
import { TasksPanel } from "./tasks-panel";
import { NotesTimeline } from "./notes-timeline";
import { LeadFilesPanel } from "./lead-files-panel";

type Tab = "Overview" | "Tasks" | "Notes" | "Files";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function toInput(lead?: Lead): LeadInput {
  return {
    contact_type: lead?.contact_type ?? "Individual",
    company_name: lead?.company_name ?? "",
    first_name: lead?.first_name ?? "",
    last_name: lead?.last_name ?? "",
    phone: lead?.phone ?? "",
    email: lead?.email ?? "",
    address: lead?.address ?? "",
    zip: lead?.zip ?? "",
    source: lead?.source ?? "",
    project_type: lead?.project_type ?? "",
    stage: lead?.stage ?? "Unsorted",
    value: lead ? String(lead.value ?? "") : "",
    lead_cost: lead?.lead_cost != null ? String(lead.lead_cost) : "",
    notes: lead?.notes ?? "",
    has_appt: lead?.has_appt ?? false,
    second_contact_first_name: lead?.second_contact_first_name ?? "",
    second_contact_last_name: lead?.second_contact_last_name ?? "",
    second_contact_phone: lead?.second_contact_phone ?? "",
    assigned_to: lead?.assigned_to ?? "",
  };
}

export function LeadForm({
  lead,
  reps,
  stages,
  calendars,
  tasks,
  notes,
  files,
  readOnly,
  canDelete,
  onCancel,
  onSaved,
  onDeleted,
}: {
  lead?: Lead;
  reps: Profile[];
  stages: PipelineStageRow[];
  calendars: CalendarRow[];
  tasks?: LeadTask[];
  notes?: LeadNote[];
  files?: LeadFile[];
  readOnly?: boolean;
  canDelete?: boolean;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<LeadInput>(toInput(lead));
  const [hasSecondContact, setHasSecondContact] = useState(
    !!(lead?.second_contact_first_name || lead?.second_contact_phone)
  );
  const [showBooking, setShowBooking] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");
  const [lastSaved, setLastSaved] = useState(form);
  const skipNextAutosave = useRef(true);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [refundStatus, setRefundStatus] = useState<RefundStatus>(lead?.refund_status ?? "None");
  const [refundRequestedAt, setRefundRequestedAt] = useState<string | null>(
    lead?.refund_requested_at ?? null
  );
  const [refundPending, setRefundPending] = useState(false);

  const stageIndex = stages.findIndex((s) => s.name === form.stage);
  const stageTotal = stages.length;

  function callPhone(phone: string) {
    window.dispatchEvent(new CustomEvent("crm:call", { detail: { phone, leadId: lead?.id } }));
  }

  function textPhone() {
    if (!lead) return;
    onCancel();
    router.push(`/reply-inbox?leadId=${lead.id}`);
  }

  async function handleRequestRefund() {
    if (!lead) return;
    setRefundPending(true);
    setError("");
    const result = await requestLeadRefund(lead.id);
    setRefundPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setRefundStatus("Requested");
    setRefundRequestedAt(new Date().toISOString());
  }

  async function handleResolveRefund(status: "Received" | "Denied") {
    if (!lead) return;
    setRefundPending(true);
    setError("");
    const result = await resolveLeadRefund(lead.id, status);
    setRefundPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setRefundStatus(status);
  }
  const [booking, setBooking] = useState({
    date: todayISO(),
    time: "09:00",
    eventType: "Estimate",
    assignedTo: "",
    projectType: "",
    notes: "",
  });

  const set = <K extends keyof LeadInput>(k: K, v: LeadInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function refresh() {
    startTransition(() => router.refresh());
  }

  const autosaveDirty = form !== lastSaved;

  useEffect(() => {
    if (!lead || readOnly) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    const valid =
      form.contact_type === "Company"
        ? form.company_name.trim() && form.phone.trim()
        : form.first_name.trim() && form.last_name.trim() && form.phone.trim();
    if (!valid) return;

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      const payload = hasSecondContact
        ? form
        : {
            ...form,
            second_contact_first_name: "",
            second_contact_last_name: "",
            second_contact_phone: "",
          };
      const result = await updateLead(lead.id, payload);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setLastSaved(form);
      refresh();
    }, 1000);

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, hasSecondContact]);

  async function handleSave() {
    const valid =
      form.contact_type === "Company"
        ? form.company_name.trim() && form.phone.trim()
        : form.first_name.trim() && form.last_name.trim() && form.phone.trim();
    if (!valid) {
      setError("Fill in the required fields (marked *) before saving.");
      return;
    }
    setPending(true);
    setError("");
    const payload = hasSecondContact
      ? form
      : {
          ...form,
          second_contact_first_name: "",
          second_contact_last_name: "",
          second_contact_phone: "",
        };
    const result = lead
      ? await updateLead(lead.id, payload)
      : await createLead(payload);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    setLastSaved(form);
    refresh();
    onSaved();
  }

  async function handleDelete() {
    if (!lead) return;
    setPending(true);
    const result = await deleteLead(lead.id);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    refresh();
    onDeleted?.();
  }

  async function handleConvert() {
    if (!lead) return;
    setPending(true);
    const result = await convertLeadToJob(lead);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    refresh();
    onSaved();
  }

  async function handleBook() {
    if (!lead) return;
    setPending(true);
    const contactName =
      form.contact_type === "Company"
        ? form.company_name
        : `${form.first_name} ${form.last_name}`.trim();
    const result = await bookAppointmentForLead(lead.id, lead.stage, {
      title: `${booking.eventType} — ${contactName}`,
      date: booking.date,
      time: booking.time,
      eventType: booking.eventType,
      assignedTo: booking.assignedTo,
      notes: booking.notes,
      projectType: booking.projectType,
    });
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    refresh();
    onSaved();
  }

  return (
    <Modal title={lead ? leadDisplayName(lead) : "New Contact"} onClose={onCancel}>
      <fieldset disabled={readOnly || pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <Field label="Contact Type">
            <div className="segmented">
              <button
                type="button"
                className={
                  "segmented-btn" +
                  (form.contact_type === "Individual" ? " active" : "")
                }
                onClick={() => set("contact_type", "Individual")}
              >
                Individual
              </button>
              <button
                type="button"
                className={
                  "segmented-btn" +
                  (form.contact_type === "Company" ? " active" : "")
                }
                onClick={() => set("contact_type", "Company")}
              >
                Company
              </button>
            </div>
          </Field>
          {form.contact_type === "Company" && (
            <Field label="Company Name *">
              <input
                value={form.company_name}
                onChange={(e) => set("company_name", e.target.value)}
                placeholder="Business name"
              />
            </Field>
          )}
          <Field
            label={
              form.contact_type === "Company"
                ? "Contact Person First Name"
                : "First Name *"
            }
          >
            <input
              value={form.first_name}
              onChange={(e) => set("first_name", e.target.value)}
            />
          </Field>
          <Field
            label={
              form.contact_type === "Company"
                ? "Contact Person Last Name"
                : "Last Name *"
            }
          >
            <input
              value={form.last_name}
              onChange={(e) => set("last_name", e.target.value)}
            />
          </Field>
          <Field label="Phone *">
            <input
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="(555) 555-5555"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="client@email.com"
            />
          </Field>
        </div>

        {lead && (form.phone || form.address || form.email) && (
          <div className="contact-card contact-card-actions-row" style={{ marginBottom: 14 }}>
            {form.address && (
              <a href={mapsUrl(form.address)} target="_blank" rel="noopener noreferrer">
                📍 {form.address}
              </a>
            )}
            {form.phone && (
              <>
                <button
                  type="button"
                  className="icon-btn contact-quick-action"
                  onClick={() => callPhone(form.phone)}
                  title="Call"
                  aria-label="Call"
                >
                  📞 Call
                </button>
                <button
                  type="button"
                  className="icon-btn contact-quick-action"
                  onClick={() => textPhone()}
                  title="Text"
                  aria-label="Text"
                >
                  💬 Text
                </button>
              </>
            )}
            {form.email && (
              <a
                href={`mailto:${form.email}`}
                className="icon-btn contact-quick-action"
                title="Email"
              >
                ✉ Email
              </a>
            )}
          </div>
        )}

        {hasSecondContact ? (
          <div className="second-contact-block">
            <div className="second-contact-head">
              <span>Second Contact</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setHasSecondContact(false)}
                aria-label="Remove second contact"
              >
                ✕
              </button>
            </div>
            <div className="form-grid">
              <Field label="First Name">
                <input
                  value={form.second_contact_first_name}
                  onChange={(e) =>
                    set("second_contact_first_name", e.target.value)
                  }
                />
              </Field>
              <Field label="Last Name">
                <input
                  value={form.second_contact_last_name}
                  onChange={(e) =>
                    set("second_contact_last_name", e.target.value)
                  }
                />
              </Field>
              <Field label="Phone">
                <input
                  value={form.second_contact_phone}
                  onChange={(e) => set("second_contact_phone", e.target.value)}
                />
              </Field>
            </div>
          </div>
        ) : (
          !readOnly && (
            <button
              type="button"
              className="btn-ghost small"
              onClick={() => setHasSecondContact(true)}
            >
              + Add second contact (e.g. spouse / co-owner)
            </button>
          )
        )}

        {lead && stageTotal > 0 && (
          <div className="stage-progress">
            <div className="stage-progress-label">
              <Badge color={stageColor(stages, form.stage)}>{form.stage}</Badge>
              {stageIndex >= 0 && (
                <span className="stage-progress-count">
                  Stage {stageIndex + 1} of {stageTotal}
                </span>
              )}
            </div>
            <div className="stage-progress-bar">
              {stages.map((s, i) => (
                <span
                  key={s.id}
                  className={"stage-progress-seg" + (i === stageIndex ? " active" : "")}
                />
              ))}
            </div>
          </div>
        )}

        {lead && (
          <div className="chip-row no-margin ta-tabs">
            {(["Overview", "Tasks", "Notes", "Files"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                className={"chip" + (tab === t ? " chip-active" : "")}
                onClick={() => setTab(t)}
              >
                {t}
                {t === "Tasks" && (tasks ?? []).filter((task) => !task.completed_at).length > 0
                  ? ` (${(tasks ?? []).filter((task) => !task.completed_at).length})`
                  : ""}
                {t === "Notes" && (notes ?? []).length > 0 ? ` (${(notes ?? []).length})` : ""}
                {t === "Files" && (files ?? []).length > 0 ? ` (${(files ?? []).length})` : ""}
              </button>
            ))}
          </div>
        )}

        {(!lead || tab === "Overview") && (
          <>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <Field label="Address">
            <AddressAutocompleteInput
              value={form.address}
              onChange={(v) => set("address", v)}
              onZipChange={(v) => set("zip", v)}
              placeholder="Job site address"
            />
          </Field>
          <Field label="Zip">
            <input value={form.zip} onChange={(e) => set("zip", e.target.value)} />
          </Field>
          <Field label="Project Type">
            <input
              value={form.project_type}
              onChange={(e) => set("project_type", e.target.value)}
              placeholder="Kitchen, Roofing..."
            />
          </Field>
          <Field label="Source">
            <input
              value={form.source}
              onChange={(e) => set("source", e.target.value)}
              placeholder="Referral, website..."
            />
          </Field>
          <Field label="Est. Value">
            <input
              value={form.value}
              onChange={(e) => set("value", e.target.value)}
              placeholder="0"
              inputMode="decimal"
            />
          </Field>
          <Field label="Lead Cost">
            <input
              value={form.lead_cost}
              onChange={(e) => set("lead_cost", e.target.value)}
              placeholder="0"
              inputMode="decimal"
            />
          </Field>
          {form.lead_cost.trim() !== "" && (
            <Field label="Est. Margin">
              <div className="ta-readonly-value">
                {money((Number(form.value) || 0) - (Number(form.lead_cost) || 0))}
              </div>
            </Field>
          )}
          <Field label="Stage">
            <select value={form.stage} onChange={(e) => set("stage", e.target.value as LeadInput["stage"])}>
              {stages.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Has Appointment?">
            <select
              value={form.has_appt ? "yes" : "no"}
              onChange={(e) => set("has_appt", e.target.value === "yes")}
            >
              <option value="no">Not yet</option>
              <option value="yes">Scheduled</option>
            </select>
          </Field>
          <Field label="Assigned Rep">
            <select
              value={form.assigned_to}
              onChange={(e) => set("assigned_to", e.target.value)}
            >
              <option value="">Unassigned</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || r.email}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {lead && (
          <div className="second-contact-block">
            <div className="second-contact-head">
              <span>↩ Lead Refund (RTP)</span>
              {refundStatus !== "None" && (
                <Badge
                  color={
                    refundStatus === "Requested"
                      ? "#C7691B"
                      : refundStatus === "Received"
                        ? "#2F855A"
                        : "#C0392B"
                  }
                >
                  {refundStatus}
                </Badge>
              )}
            </div>
            {refundStatus === "None" && (
              <button
                type="button"
                className="btn-ghost small"
                onClick={handleRequestRefund}
                disabled={readOnly || refundPending}
              >
                {refundPending ? "Requesting…" : "Request lead refund"}
              </button>
            )}
            {refundStatus === "Requested" && (
              <div className="modal-actions">
                <div>
                  {refundRequestedAt && (
                    <span className="empty-hint">
                      Requested{" "}
                      {new Date(refundRequestedAt).toLocaleDateString("en-US", {
                        month: "2-digit",
                        day: "2-digit",
                        year: "numeric",
                      })}
                    </span>
                  )}
                </div>
                {!readOnly && (
                  <div>
                    <button
                      type="button"
                      className="btn-ghost small"
                      onClick={() => handleResolveRefund("Received")}
                      disabled={refundPending}
                    >
                      Mark received
                    </button>
                    <button
                      type="button"
                      className="btn-ghost small"
                      onClick={() => handleResolveRefund("Denied")}
                      disabled={refundPending}
                    >
                      Mark denied
                    </button>
                  </div>
                )}
              </div>
            )}
            {(refundStatus === "Received" || refundStatus === "Denied") && !readOnly && (
              <button
                type="button"
                className="btn-ghost small"
                onClick={handleRequestRefund}
                disabled={refundPending}
              >
                Request again
              </button>
            )}
          </div>
        )}

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
          />
        </Field>

        {lead && !readOnly && (
          showBooking ? (
            <div className="second-contact-block">
              <div className="second-contact-head">
                <span>Book Appointment</span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowBooking(false)}
                  aria-label="Cancel booking"
                >
                  ✕
                </button>
              </div>
              <div className="form-grid">
                <Field label="Date">
                  <input
                    type="date"
                    value={booking.date}
                    onChange={(e) =>
                      setBooking((b) => ({ ...b, date: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Time">
                  <TimeField
                    value={booking.time}
                    onChange={(v) => setBooking((b) => ({ ...b, time: v }))}
                  />
                </Field>
                <Field label="Calendar">
                  <select
                    value={booking.eventType}
                    onChange={(e) =>
                      setBooking((b) => ({ ...b, eventType: e.target.value }))
                    }
                  >
                    {calendars.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Assigned To">
                  <select
                    value={booking.assignedTo}
                    onChange={(e) =>
                      setBooking((b) => ({ ...b, assignedTo: e.target.value }))
                    }
                  >
                    <option value="">Unassigned</option>
                    {reps.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name || r.email}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Project Type">
                  <input
                    value={booking.projectType}
                    onChange={(e) =>
                      setBooking((b) => ({ ...b, projectType: e.target.value }))
                    }
                    placeholder="Kitchen, Roofing..."
                  />
                </Field>
              </div>
              <Field label="Notes">
                <textarea
                  value={booking.notes}
                  onChange={(e) => setBooking((b) => ({ ...b, notes: e.target.value }))}
                  rows={2}
                  placeholder="Anything the rep should know for this appointment"
                />
              </Field>
              <button
                type="button"
                className="btn-primary small"
                onClick={handleBook}
                disabled={pending}
              >
                Confirm &amp; Add to Calendar
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-ghost small"
              onClick={() => {
                setBooking((b) => ({ ...b, projectType: form.project_type }));
                setShowBooking(true);
              }}
              style={{ marginBottom: 14 }}
            >
              📅 Book Appointment
            </button>
          )
        )}
          </>
        )}

        {lead && tab === "Tasks" && (
          <TasksPanel
            leadId={lead.id}
            tasks={tasks ?? []}
            reps={reps}
            readOnly={readOnly}
            onChanged={refresh}
          />
        )}

        {lead && tab === "Notes" && (
          <NotesTimeline
            leadId={lead.id}
            notes={notes ?? []}
            reps={reps}
            readOnly={readOnly}
            onChanged={refresh}
          />
        )}

        {lead && tab === "Files" && (
          <LeadFilesPanel
            leadId={lead.id}
            files={files ?? []}
            reps={reps}
            readOnly={readOnly}
            onChanged={refresh}
          />
        )}

        {error && <p className="error-note">{error}</p>}

        <div className="modal-actions">
          <div className="modal-actions-left">
            {lead && !readOnly && canDelete && (
              <button type="button" className="btn-danger-ghost" onClick={handleDelete}>
                Delete
              </button>
            )}
            {lead && !readOnly && form.stage !== "Won" && (
              <button type="button" className="btn-ghost" onClick={handleConvert}>
                Mark Won → Create Job
              </button>
            )}
            {lead && !readOnly && (
              <span className="empty-hint">{autosaveDirty ? "Saving…" : "✓ Saved"}</span>
            )}
          </div>
          <div>
            <button type="button" className="btn-ghost" onClick={onCancel}>
              {readOnly || lead ? "Close" : "Cancel"}
            </button>
            {!readOnly && (
              <button type="button" className="btn-primary" onClick={handleSave} disabled={pending}>
                {pending ? "Saving…" : lead ? "Save Now" : "Save"}
              </button>
            )}
          </div>
        </div>
      </fieldset>
    </Modal>
  );
}
