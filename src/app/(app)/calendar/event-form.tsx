"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { TimeField } from "@/components/ui/time-field";
import {
  EVENT_STATUSES,
  QUICK_TEXT_DEFAULTS,
  FOLLOW_UP_STAGE,
  REP_APPOINTMENT_INFO_DEFAULT,
  addHour,
  appointmentResultOverdue,
  endsNextDay,
  hasAppointmentResult,
  fillQuickTextVariables,
  formatTimeRange,
  fillRepInfoTemplate,
  leadDisplayName,
  mapsUrl,
  money,
  normalizePhone,
  type CalendarRow,
  type DocumentRecord,
  type Event,
  type EventInput,
  type EventStatus,
  type Job,
  type Lead,
  type LeadNote,
  type LeadTask,
  type PipelineStageRow,
  type Profile,
  type SmsQuickText,
} from "@/lib/data/types";
import {
  createEvent,
  deleteEvent,
  markRepInfoSent,
  setEventResult,
  updateEvent,
} from "@/lib/actions/events";
import { getQuickTextOptions } from "@/lib/actions/sms-quick-texts";
import { sendSms } from "@/lib/actions/sms";
import { moveLeadStage } from "@/lib/actions/leads";
import { addLeadNote } from "@/lib/actions/lead-notes";
import { TasksPanel } from "../pipeline/tasks-panel";
import { MessagesPanel } from "../pipeline/messages-panel";
import { NotesTimeline } from "../pipeline/notes-timeline";

type Tab = "Appointment" | "Result" | "Lead" | "Tasks" | "Estimates" | "Texts" | "Notes";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Where a lead most likely belongs once the appointment is over. Only a
 * starting suggestion -- the stage dropdown stays editable, because only
 * the rep knows whether "Showed" meant a signature or a maybe.
 */
function suggestedStageFor(outcome: EventStatus, currentStage: string): string {
  if (outcome === "No-show" || outcome === "Cancelled") return FOLLOW_UP_STAGE;
  return currentStage;
}

function friendlyWhen(dateStr: string, timeStr: string, endTimeStr: string): string {
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
  // ASCII hyphen: this goes out as an SMS (see formatTimeRange).
  const timeLabel = timeStr
    ? formatTimeRange(timeStr, endTimeStr || null, "12h", "-").toLowerCase()
    : "";
  return timeLabel ? `${dayLabel} at ${timeLabel}` : dayLabel;
}

function toInput(event?: Event, initialDate?: string): EventInput {
  return {
    title: event?.title ?? "",
    date: event?.date ?? initialDate ?? todayISO(),
    time: event?.time ?? "09:00",
    end_time: event?.end_time ?? "",
    event_type: event?.event_type ?? "Estimate",
    status: event?.status ?? "New",
    assigned_to: event?.assigned_to ?? "",
    second_assigned_to: event?.second_assigned_to ?? "",
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
  leadNotes,
  documents,
  calendars,
  stages,
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
  leadNotes?: LeadNote[];
  documents?: DocumentRecord[];
  calendars: CalendarRow[];
  stages?: PipelineStageRow[];
  readOnly?: boolean;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<EventInput>(toInput(event, initialDate));
  // Snapshot of how the appointment looked when opened, so closing can
  // tell "nothing touched" from "about to lose work".
  const [openedWith] = useState<EventInput>(() => toInput(event, initialDate));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("Appointment");
  const [showQuickText, setShowQuickText] = useState(false);
  const [quickTextOptions, setQuickTextOptions] = useState<{
    companyName: string;
    quickTexts: SmsQuickText[];
    website: string | null;
    facebookUrl: string | null;
    instagramUrl: string | null;
  } | null>(null);
  const [repTextStatus, setRepTextStatus] = useState<"idle" | "pending" | "sent" | "error">(
    "idle"
  );
  const [repTextError, setRepTextError] = useState("");
  const [repSentAt, setRepSentAt] = useState<string | null>(event?.rep_info_sent_at ?? null);
  const [secondRepTextStatus, setSecondRepTextStatus] = useState<
    "idle" | "pending" | "sent" | "error"
  >("idle");
  const [secondRepTextError, setSecondRepTextError] = useState("");
  const [secondRepSentAt, setSecondRepSentAt] = useState<string | null>(
    event?.second_rep_info_sent_at ?? null
  );
  const [resultStage, setResultStage] = useState("");
  // Selected outcome, not yet written. Empty means "unchanged".
  const [pendingOutcome, setPendingOutcome] = useState<EventStatus | "">("");
  const [resultNote, setResultNote] = useState("");
  const [resultPending, setResultPending] = useState(false);
  const [resultSaved, setResultSaved] = useState(false);
  // Tracks whether the user actually toggled each confirmation badge, so a
  // form left open while a rep/client texts YES doesn't save the stale
  // value back over their reply.
  const [confirmTouched, setConfirmTouched] = useState({ customer: false, rep: false });

  const lead = event?.lead_id ? leads?.find((l) => l.id === event.lead_id) ?? null : null;
  const linkedTasks = lead ? (leadTasks ?? []).filter((t) => t.lead_id === lead.id) : [];
  const openTaskCount = linkedTasks.filter((t) => !t.completed_at).length;
  const linkedNotes = lead ? (leadNotes ?? []).filter((n) => n.lead_id === lead.id) : [];
  const linkedEstimates = lead
    ? (documents ?? []).filter((d) => d.contact_id === lead.id)
    : [];
  // Captured once on open rather than read during render -- calling the
  // clock mid-render is impure, and the badge doesn't need to tick.
  const [openedAtMs] = useState(() => Date.now());
  const resultOverdue = !!event && appointmentResultOverdue(event, openedAtMs);
  const resultRecorded = !!event && hasAppointmentResult(form.status);
  // Something to save: a new outcome, a note, or a stage change.
  const resultDirty =
    !!pendingOutcome ||
    resultNote.trim().length > 0 ||
    (!!resultStage && !!lead && resultStage !== lead.stage);

  function repName(id: string | null) {
    if (!id) return null;
    const rep = reps.find((r) => r.id === id);
    return rep?.name || rep?.email || null;
  }

  const notesAuthorName = event?.notes_updated_by ? repName(event.notes_updated_by) : null;

  const set = <K extends keyof EventInput>(k: K, v: EventInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Picking an outcome used to save on the spot, which threw away
  // anything typed afterwards -- and the note field sits below the
  // buttons, so that was everything. Selection is held here until Save
  // Result is pressed.
  function pickOutcome(outcome: EventStatus) {
    setPendingOutcome(outcome);
    setResultSaved(false);
    // No-show and Cancelled belong in follow-up; only suggest it while
    // the user hasn't chosen a stage themselves.
    if (!resultStage && lead) setResultStage(suggestedStageFor(outcome, lead.stage));
  }

  async function saveResult() {
    if (!lead || !event) return;
    const outcome = (pendingOutcome || form.status) as EventStatus;
    const chosenStage = resultStage || suggestedStageFor(outcome, lead.stage);
    setResultPending(true);
    setError("");

    // The outcome itself first: it's the thing the red badge and the
    // follow-up cron both read, so it must land even if a later step
    // fails. Everything after it is optional detail.
    const statusResult = await setEventResult(event.id, outcome);
    if (statusResult?.error) {
      setResultPending(false);
      setError(statusResult.error);
      return;
    }
    set("status", outcome);

    if (chosenStage !== lead.stage) {
      const stageResult = await moveLeadStage(lead.id, chosenStage);
      if (stageResult?.error) {
        setResultPending(false);
        setError(stageResult.error);
        return;
      }
    }
    if (resultNote.trim()) {
      const noteResult = await addLeadNote(lead.id, resultNote.trim(), event.id);
      if (noteResult?.error) {
        setResultPending(false);
        setError(noteResult.error);
        return;
      }
    }
    setResultPending(false);
    setResultNote("");
    setResultStage("");
    setPendingOutcome("");
    setResultSaved(true);
    router.refresh();
  }

  async function handleSave() {
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }
    setPending(true);
    setError("");
    const result = event
      ? await updateEvent(event.id, form, confirmTouched)
      : await createEvent(form);
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

  /**
   * Closing without saving.
   *
   * Autosave was the obvious answer here and the wrong one: this modal
   * has Cancel and Delete, Status drives the no-show and reminder
   * automation, and a date field emits "08/0" as you type it. Saving
   * silently would make a mis-click permanent and could fire a real
   * text. Asking before discarding solves the actual problem -- losing
   * work to a stray click on the backdrop -- without any of that.
   *
   * The unsaved result note counts too: that tab says nothing is stored
   * until Save Result, which makes it exactly the thing people lose.
   */
  const isDirty =
    !readOnly &&
    (JSON.stringify(form) !== JSON.stringify(openedWith) ||
      resultNote.trim() !== "" ||
      pendingOutcome !== "");

  function requestClose() {
    if (isDirty && !window.confirm("Discard your unsaved changes to this appointment?")) return;
    onCancel();
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

  async function sendRepInfo(repId: string, which: "primary" | "second") {
    const setStatus = which === "primary" ? setRepTextStatus : setSecondRepTextStatus;
    const setErrorMsg = which === "primary" ? setRepTextError : setSecondRepTextError;
    const setSentAt = which === "primary" ? setRepSentAt : setSecondRepSentAt;

    const rep = reps.find((r) => r.id === repId);
    if (!rep) return;
    if (!rep.phone) {
      setStatus("error");
      setErrorMsg(`${rep.name || rep.email || "This rep"} doesn't have a phone number on file.`);
      return;
    }
    setStatus("pending");
    setErrorMsg("");

    const address = lead?.address || jobs.find((j) => j.id === form.job_id)?.address || null;
    const dateLabel = new Date(`${form.date}T00:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const timeLabel = formatTimeRange(form.time, form.end_time, "12h", "-");

    // Some leads only ever captured a phone number, which gets stored as
    // the "name" -- never expose that as if it were a client name.
    const rawName = lead ? leadDisplayName(lead) : "";
    const looksLikePhone = lead?.phone && normalizePhone(rawName) === normalizePhone(lead.phone);
    const clientName = looksLikePhone ? "" : rawName;

    const { repInfoTemplate } = await getQuickTextOptions();
    const body = fillRepInfoTemplate(repInfoTemplate || REP_APPOINTMENT_INFO_DEFAULT, {
      title: form.title || "Untitled",
      clientName,
      when: `${dateLabel}${timeLabel ? ` at ${timeLabel}` : ""}`,
      addressLink: address ? mapsUrl(address) : "",
      projectType: lead?.project_type || "",
    });

    // Tagged "rep" and threaded under the lead: it belongs in that
    // contact's history, but not in the Reply Inbox as a conversation
    // with the rep.
    const result = await sendSms(lead?.id ?? null, rep.phone, body, "rep");
    if (result?.error) {
      setStatus("error");
      setErrorMsg(result.error);
      return;
    }
    setStatus("idle");
    setSentAt(new Date().toISOString());
    if (event?.id) {
      await markRepInfoSent(event.id, which);
    }
  }

  function sendQuickText(text: SmsQuickText) {
    if (!lead?.phone || !quickTextOptions) return;
    const repName = reps.find((r) => r.id === form.assigned_to)?.name ?? "";
    const filled = fillQuickTextVariables(text.body || QUICK_TEXT_DEFAULTS[text.key], {
      firstName: lead.first_name ?? "",
      when: friendlyWhen(form.date, form.time, form.end_time),
      repName,
      companyName: quickTextOptions.companyName,
      website: quickTextOptions.website,
      facebookUrl: quickTextOptions.facebookUrl,
      instagramUrl: quickTextOptions.instagramUrl,
    });
    setShowQuickText(false);
    textPhone(lead.phone, filled);
  }

  return (
    <Modal title={event ? "Edit Appointment" : "New Appointment"} onClose={requestClose} wide>
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
                      <>
                        {quickTextOptions.quickTexts.map((text) => (
                          <button
                            key={text.key}
                            type="button"
                            className="quick-text-item"
                            onClick={() => sendQuickText(text)}
                          >
                            {text.label}
                          </button>
                        ))}
                        {/* These compose the message and open the Reply
                            Inbox rather than sending -- without saying so,
                            it reads as "sent" and the text never goes. */}
                        <div className="quick-text-item quick-text-hint">
                          Opens the message ready to send
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {lead.email && <div className="contact-card-line">✉ {lead.email}</div>}
          {lead.project_type && (
            <div className="contact-card-line">Project Type: {lead.project_type}</div>
          )}
          {lead.source && <div className="contact-card-line">Source: {lead.source}</div>}
        </div>
      )}

      {lead && (
        <div className="chip-row no-margin ta-tabs">
          {(["Appointment", "Result", "Lead", "Tasks", "Estimates", "Texts", "Notes"] as Tab[]).map(
            (t) => (
              <button
                key={t}
                type="button"
                className={
                  "chip" +
                  (tab === t ? " chip-active" : "") +
                  // Only once the appointment has been and gone. A booking
                  // made for next week isn't missing its result yet, and a
                  // badge that's always red stops being read.
                  (t === "Result" && resultOverdue ? " chip-overdue" : "")
                }
                onClick={() => setTab(t)}
              >
                {t}
                {t === "Result" && resultOverdue ? " •" : ""}
                {t === "Tasks" && openTaskCount > 0 ? ` (${openTaskCount})` : ""}
                {t === "Estimates" && linkedEstimates.length > 0
                  ? ` (${linkedEstimates.length})`
                  : ""}
              </button>
            )
          )}
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
            <Field label="Start Time">
              <TimeField value={form.time} onChange={(v) => set("time", v)} />
            </Field>
            <Field label="End Time">
              {form.end_time ? (
                <>
                  <div className="end-time-row">
                    <TimeField value={form.end_time} onChange={(v) => set("end_time", v)} />
                    <button
                      type="button"
                      className="btn-ghost small"
                      onClick={() => set("end_time", "")}
                      disabled={readOnly || pending}
                    >
                      Clear
                    </button>
                  </div>
                  {endsNextDay(form.time, form.end_time) && (
                    <p className="hint-note">Ends the next day.</p>
                  )}
                </>
              ) : (
                /* Opt-in rather than defaulted: an end time nobody chose
                   would be guesswork presented as fact on the customer's
                   appointment. Defaults to an hour when they ask for one. */
                <button
                  type="button"
                  className="btn-ghost small"
                  onClick={() => set("end_time", addHour(form.time))}
                  disabled={readOnly || pending}
                >
                  + Add end time
                </button>
              )}
            </Field>
            <Field label="Assigned To">
              <select
                value={form.assigned_to}
                onChange={(e) => {
                  set("assigned_to", e.target.value);
                  setRepSentAt(null);
                }}
              >
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
                    onClick={() => sendRepInfo(form.assigned_to, "primary")}
                    disabled={repTextStatus === "pending"}
                  >
                    {repTextStatus === "pending" ? "Sending…" : "📲 Text Rep Info"}
                  </button>
                  {repSentAt && (
                    <span className="cp-saved" title={`Sent ${new Date(repSentAt).toLocaleString()}`}>
                      ✓ Sent
                    </span>
                  )}
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
            <Field label="Second Assigned To">
              <select
                value={form.second_assigned_to}
                onChange={(e) => {
                  set("second_assigned_to", e.target.value);
                  setSecondRepSentAt(null);
                }}
              >
                <option value="">Unassigned</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name || r.email}
                  </option>
                ))}
              </select>
              {form.second_assigned_to && (
                <div className="rep-text-row">
                  <button
                    type="button"
                    className="btn-ghost small"
                    onClick={() => sendRepInfo(form.second_assigned_to, "second")}
                    disabled={secondRepTextStatus === "pending"}
                  >
                    {secondRepTextStatus === "pending" ? "Sending…" : "📲 Text Rep Info"}
                  </button>
                  {secondRepSentAt && (
                    <span
                      className="cp-saved"
                      title={`Sent ${new Date(secondRepSentAt).toLocaleString()}`}
                    >
                      ✓ Sent
                    </span>
                  )}
                </div>
              )}
              {secondRepTextStatus === "error" && <p className="error-note">{secondRepTextError}</p>}
            </Field>
          </div>

          <div className="form-grid">
            <Field label="Customer">
              <button
                type="button"
                className="confirm-toggle"
                onClick={() => {
                  setConfirmTouched((t) => ({ ...t, customer: true }));
                  set("customer_confirmed", !form.customer_confirmed);
                }}
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
                onClick={() => {
                  setConfirmTouched((t) => ({ ...t, rep: true }));
                  set("rep_confirmed", !form.rep_confirmed);
                }}
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
              {event?.notes_updated_at && (
                <p className="empty-hint" style={{ marginTop: 4 }}>
                  Last edited by {notesAuthorName || "Unknown"} ·{" "}
                  {new Date(event.notes_updated_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </Field>
          )}
        </fieldset>
      )}

      {lead && event && tab === "Result" && (
        <div>
          {resultRecorded ? (
            <p className="result-banner result-banner-done">
              ✓ Result recorded: <strong>{form.status}</strong>. Pick a different outcome below
              if that&apos;s wrong.
            </p>
          ) : resultOverdue ? (
            <p className="result-banner result-banner-late">
              This appointment has been and gone with no result. {repName(form.assigned_to)
                ? `${repName(form.assigned_to)} gets a text reminder`
                : "A reminder goes out"}{" "}
              an hour afterwards, and if it&apos;s still blank at 8pm the lead moves itself to{" "}
              {FOLLOW_UP_STAGE} so it doesn&apos;t go cold.
            </p>
          ) : (
            <p className="empty-hint" style={{ marginTop: 0 }}>
              What happened at this appointment? Log it here once it&apos;s done.
            </p>
          )}

          <Field label="Outcome">
            <div className="chip-row no-margin">
              {(["Showed", "No-show", "Cancelled"] as EventStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={
                    "chip" + ((pendingOutcome || form.status) === s ? " chip-active" : "")
                  }
                  onClick={() => pickOutcome(s)}
                  disabled={readOnly || resultPending}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>

          <div className="form-grid">
            <Field label="Move Lead to Stage">
              <select
                value={resultStage || lead.stage}
                onChange={(e) => setResultStage(e.target.value)}
                disabled={readOnly || resultPending}
              >
                {(stages ?? []).map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Result Note">
            <textarea
              value={resultNote}
              onChange={(e) => setResultNote(e.target.value)}
              rows={2}
              placeholder="e.g. Needs a 2nd appointment to finalize scope..."
              disabled={readOnly || resultPending}
            />
          </Field>
          <p className="hint-note">
            Nothing here is saved until you press Save Result. No-show and Cancelled suggest{" "}
            {FOLLOW_UP_STAGE}; change the stage if it belongs elsewhere.
          </p>
          {!readOnly && (
            <div className="modal-actions">
              <div>{resultSaved && <span className="cp-saved">✓ Result saved</span>}</div>
              <div>
                <button
                  type="button"
                  className="btn-primary small"
                  onClick={saveResult}
                  disabled={resultPending || !resultDirty}
                >
                  {resultPending ? "Saving…" : "Save Result"}
                </button>
              </div>
            </div>
          )}
        </div>
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
                    <td>
                      {d.date
                        ? new Date(`${d.date}T00:00:00`).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : ""}
                    </td>
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

      {lead && tab === "Texts" && (
        <MessagesPanel leadId={lead.id} phone={lead.phone ?? ""} readOnly={readOnly} />
      )}

      {lead && tab === "Notes" && (
        <div>
          <NotesTimeline
            leadId={lead.id}
            notes={linkedNotes}
            reps={reps}
            readOnly={readOnly}
            onChanged={() => router.refresh()}
          />
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
          {event?.notes_updated_at && (
            <p className="empty-hint" style={{ marginTop: 4 }}>
              Last edited by {notesAuthorName || "Unknown"} ·{" "}
              {new Date(event.notes_updated_at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          )}
        </Field>
      )}

      {(!lead || tab !== "Lead") && (
        <>
          {error && <p className="error-note">{error}</p>}
          {/* Pinned to the bottom of the modal: this form is taller than
              the viewport, so Save used to sit below the fold and had to
              be scrolled to before anything could be committed. */}
          <div className="modal-actions modal-actions-sticky">
            <div className="modal-actions-left">
              {event && !readOnly && (
                <button type="button" className="btn-danger-ghost" onClick={handleDelete}>
                  Delete
                </button>
              )}
            </div>
            <div>
              <button type="button" className="btn-ghost" onClick={requestClose}>
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
