"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import {
  EVENT_TYPES,
  type EventType,
  type Lead,
  type PipelineStage,
  type PipelineStageRow,
  type Profile,
} from "@/lib/data/types";
import { bookAppointmentForLead, createLead } from "@/lib/actions/leads";
import { createEvent } from "@/lib/actions/events";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function leadMatchLabel(l: Lead) {
  if (l.contact_type === "Company") return l.company_name || "Unnamed Company";
  return `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim();
}

export function AppointmentWizard({
  leads,
  reps,
  stages,
  onCancel,
  onFinished,
}: {
  leads: Lead[];
  reps: Profile[];
  stages: PipelineStageRow[];
  onCancel: () => void;
  onFinished: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const [contactQuery, setContactQuery] = useState("");
  const [matchedLeadId, setMatchedLeadId] = useState("");
  const [newContact, setNewContact] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
  });
  const [projectType, setProjectType] = useState("");
  const [value, setValue] = useState("");
  const [leadStage, setLeadStage] = useState<PipelineStage>("Unsorted");
  const [address, setAddress] = useState("");

  const [apptTitle, setApptTitle] = useState("");
  const [apptType, setApptType] = useState<EventType>("Estimate");
  const [apptDate, setApptDate] = useState(todayISO());
  const [apptTime, setApptTime] = useState("09:00");
  const [assignedTo, setAssignedTo] = useState("");

  const isNewContact = !!contactQuery.trim() && !matchedLeadId;
  const matchedLead = leads.find((l) => l.id === matchedLeadId);

  const matches = contactQuery.trim()
    ? leads.filter((l) => leadMatchLabel(l).toLowerCase().includes(contactQuery.toLowerCase()))
    : [];

  function pickLead(l: Lead) {
    setMatchedLeadId(l.id);
    setContactQuery(leadMatchLabel(l));
  }

  function startAsNewContact() {
    setMatchedLeadId("");
    const parts = contactQuery.split(" ");
    setNewContact((c) => ({ ...c, firstName: parts[0] || "", lastName: parts.slice(1).join(" ") || "" }));
    setStep(2);
  }

  async function finalize(createAppt: boolean) {
    setPending(true);
    setError("");

    let leadId = matchedLeadId;
    const contactName = matchedLead
      ? leadMatchLabel(matchedLead)
      : `${newContact.firstName} ${newContact.lastName}`.trim();

    if (!leadId) {
      const result = await createLead({
        contact_type: "Individual",
        company_name: "",
        first_name: newContact.firstName,
        last_name: newContact.lastName,
        phone: newContact.phone,
        email: newContact.email,
        address,
        zip: "",
        source: "",
        project_type: projectType,
        stage: leadStage,
        value,
        notes: "",
        has_appt: createAppt,
        second_contact_first_name: "",
        second_contact_last_name: "",
        second_contact_phone: "",
        assigned_to: "",
      });
      if (result?.error || !result?.id) {
        setPending(false);
        setError(result?.error || "Could not create contact.");
        return;
      }
      leadId = result.id;
    }

    if (!createAppt) {
      setPending(false);
      router.refresh();
      onFinished();
      return;
    }

    const details = {
      title: apptTitle || `${apptType} — ${contactName}`,
      date: apptDate,
      time: apptTime,
      eventType: apptType,
      assignedTo,
    };

    const result = matchedLead
      ? await bookAppointmentForLead(leadId, matchedLead.stage, details)
      : await createEvent(
          {
            title: details.title,
            date: details.date,
            time: details.time,
            event_type: details.eventType,
            assigned_to: details.assignedTo,
            job_id: "",
            notes: "",
            customer_confirmed: false,
            rep_confirmed: false,
          },
          leadId
        );

    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    router.refresh();
    onFinished();
  }

  return (
    <Modal title="New Appointment" onClose={onCancel} wide>
      <p className="wizard-sub">
        Schedule an appointment — pick a contact, confirm the lead, set the time.
      </p>

      <div className={"wizard-step" + (step === 1 ? " wizard-step-active" : "")}>
        <div className="wizard-step-head">
          <span className={"step-num" + (step > 1 ? " step-done" : "")}>
            {step > 1 ? "✓" : "1"}
          </span>
          <span className="step-label">Contact</span>
          <span className="step-hint">Name, phone, email</span>
        </div>
        {step === 1 && (
          <div className="wizard-step-body">
            <Field label="Contact *">
              <input
                value={contactQuery}
                onChange={(e) => {
                  setContactQuery(e.target.value);
                  setMatchedLeadId("");
                }}
                placeholder="Type a name — we'll create a new contact automatically if it's new"
              />
            </Field>
            {matches.length > 0 && !matchedLeadId && (
              <div className="contact-match-list">
                {matches.slice(0, 5).map((l) => (
                  <div key={l.id} className="contact-match-row" onClick={() => pickLead(l)}>
                    {leadMatchLabel(l)}
                    {l.phone && <span className="mono"> · {l.phone}</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="wizard-actions">
              <button
                className="btn-primary"
                disabled={!contactQuery.trim()}
                onClick={() => (matchedLeadId ? setStep(3) : startAsNewContact())}
              >
                Save &amp; continue →
              </button>
            </div>
          </div>
        )}
      </div>

      {(step === 2 || (step > 2 && isNewContact)) && (
        <div className={"wizard-step" + (step === 2 ? " wizard-step-active" : "")}>
          <div className="wizard-step-head">
            <span className={"step-num" + (step > 2 ? " step-done" : "")}>
              {step > 2 ? "✓" : "2"}
            </span>
            <span className="step-label">Lead</span>
            <span className="step-hint">Confirm the deal details</span>
          </div>
          {step === 2 && (
            <div className="wizard-step-body">
              <div className="form-grid">
                <Field label="First Name">
                  <input
                    value={newContact.firstName}
                    onChange={(e) => setNewContact((c) => ({ ...c, firstName: e.target.value }))}
                  />
                </Field>
                <Field label="Last Name">
                  <input
                    value={newContact.lastName}
                    onChange={(e) => setNewContact((c) => ({ ...c, lastName: e.target.value }))}
                  />
                </Field>
                <Field label="Phone *">
                  <input
                    value={newContact.phone}
                    onChange={(e) => setNewContact((c) => ({ ...c, phone: e.target.value }))}
                  />
                </Field>
                <Field label="Email">
                  <input
                    value={newContact.email}
                    onChange={(e) => setNewContact((c) => ({ ...c, email: e.target.value }))}
                  />
                </Field>
                <Field label="Project Type">
                  <input
                    value={projectType}
                    onChange={(e) => setProjectType(e.target.value)}
                    placeholder="Kitchen, Roofing..."
                  />
                </Field>
                <Field label="Est. Value">
                  <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Stage">
                  <select
                    value={leadStage}
                    onChange={(e) => setLeadStage(e.target.value as PipelineStage)}
                  >
                    {stages.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Address">
                  <input value={address} onChange={(e) => setAddress(e.target.value)} />
                </Field>
              </div>
              <div className="wizard-actions">
                <button className="btn-ghost" onClick={() => setStep(1)}>
                  Back
                </button>
                <button
                  className="btn-primary"
                  disabled={!newContact.phone.trim()}
                  onClick={() => setStep(3)}
                >
                  Save &amp; continue →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className={"wizard-step" + (step === 3 ? " wizard-step-active" : "")}>
        <div className="wizard-step-head">
          <span className="step-num">{isNewContact ? 3 : 2}</span>
          <span className="step-label">
            Appointment <span className="step-optional">· optional</span>
          </span>
          <span className="step-hint">Skip or schedule</span>
        </div>
        {step === 3 && (
          <div className="wizard-step-body">
            <div className="form-grid">
              <Field label="Title">
                <input
                  value={apptTitle}
                  onChange={(e) => setApptTitle(e.target.value)}
                  placeholder="Estimate walkthrough..."
                />
              </Field>
              <Field label="Type">
                <select value={apptType} onChange={(e) => setApptType(e.target.value as EventType)}>
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Date">
                <input type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} />
              </Field>
              <Field label="Time">
                <input type="time" value={apptTime} onChange={(e) => setApptTime(e.target.value)} />
              </Field>
              <Field label="Assigned To">
                <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                  <option value="">Unassigned</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name || r.email}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {error && <p className="error-note">{error}</p>}
            <div className="wizard-actions">
              <button className="btn-ghost" onClick={() => setStep(isNewContact ? 2 : 1)}>
                Back
              </button>
              <button className="btn-ghost" onClick={() => finalize(false)} disabled={pending}>
                Skip
              </button>
              <button className="btn-primary" onClick={() => finalize(true)} disabled={pending}>
                {pending ? "Scheduling…" : "Schedule appointment"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="modal-actions wizard-footer">
        <div className="modal-actions-left">
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <div className="wizard-footer-right">
          <span className="step-indicator mono">
            Step {isNewContact ? step : step === 1 ? 1 : 2} of {isNewContact ? 3 : 2}
          </span>
        </div>
      </div>
    </Modal>
  );
}
