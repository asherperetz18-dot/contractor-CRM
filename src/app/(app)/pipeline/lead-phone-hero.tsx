"use client";

import { useEffect, useState } from "react";
import { useTimeFormat } from "@/components/time-format-context";
import { formatClock, mapsUrl, stageColor, type PipelineStageRow } from "@/lib/data/types";
import { getAppointmentsForLead, type LeadAppointmentRow } from "@/lib/actions/events";
import { dayLabel } from "@/lib/phone-today";
import { leadSubline, nextAppointment } from "@/lib/phone-lead";
import { MobileIcon } from "../mobile-icon";

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The top of a lead on a phone (DECISIONS #092): where and whose, the
 * four things you do to a customer from a driveway, how far along the
 * lead is, and the next visit. Mounted only at phone width (the lead
 * window's usePhoneWidth), so wider screens never fetch the visit. Sits
 * outside the form's fieldset: a read-only viewer can still call.
 */
export function LeadPhoneHero({
  leadId,
  address,
  email,
  phone,
  source,
  repName,
  stage,
  stages,
  onCall,
  onText,
  onOpenAppointments,
}: {
  leadId: string;
  address: string;
  email: string;
  /** The number a call dials, null when the contact has none. */
  phone: string | null;
  source: string;
  repName: string | null;
  stage: string;
  stages: PipelineStageRow[];
  onCall: (phone: string) => void;
  onText: () => void;
  onOpenAppointments: () => void;
}) {
  const timeFormat = useTimeFormat();
  const [todayISO] = useState(localToday);
  const [next, setNext] = useState<LeadAppointmentRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    // No card on a failed load: the Appointments tab has the full list
    // and says what went wrong.
    getAppointmentsForLead(leadId)
      .then((r) => {
        if (!cancelled) setNext(nextAppointment(r.appointments ?? [], todayISO));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [leadId, todayISO]);

  const stageIndex = stages.findIndex((s) => s.name === stage);

  return (
    <div className="lph" data-mtone="dispatch">
      {address && <p className="lph-addr">{address}</p>}
      <p className="lph-sub">{leadSubline(source, repName)}</p>

      <div className="lph-actions">
        <button type="button" className="lph-act" disabled={!phone} onClick={() => phone && onCall(phone)}>
          <span className="lph-circ">
            <MobileIcon name="dialer" />
          </span>
          Call
        </button>
        <button type="button" className="lph-act" disabled={!phone} onClick={onText}>
          <span className="lph-circ">
            <MobileIcon name="texts" />
          </span>
          Text
        </button>
        {email ? (
          <a className="lph-act" href={`mailto:${email}`}>
            <span className="lph-circ">
              <MobileIcon name="mail" />
            </span>
            Email
          </a>
        ) : (
          <button type="button" className="lph-act" disabled>
            <span className="lph-circ">
              <MobileIcon name="mail" />
            </span>
            Email
          </button>
        )}
        {address ? (
          <a className="lph-act" href={mapsUrl(address)} target="_blank" rel="noopener noreferrer">
            <span className="lph-circ">
              <MobileIcon name="navigate" />
            </span>
            Directions
          </a>
        ) : (
          <button type="button" className="lph-act" disabled>
            <span className="lph-circ">
              <MobileIcon name="navigate" />
            </span>
            Directions
          </button>
        )}
      </div>

      {stageIndex >= 0 && (
        <div className="lph-card">
          <div className="lph-stage-row">
            <span className="lph-sec">Stage</span>
            <span className="lph-stage">
              <span className="lph-dot" style={{ background: stageColor(stages, stage) }} aria-hidden="true" />
              {stage}
            </span>
          </div>
          <div className="lph-bar" aria-hidden="true">
            {stages.map((s, i) => (
              <span key={s.id} className={i <= stageIndex ? "on" : ""} />
            ))}
          </div>
          <span className="lph-count">
            Stage {stageIndex + 1} of {stages.length}
          </span>
        </div>
      )}

      {next && (
        <div className="lph-card lph-appt">
          <button type="button" className="lph-appt-body" onClick={onOpenAppointments}>
            <span className="lph-appt-icon">
              <MobileIcon name="calendar" />
            </span>
            <span className="lph-appt-text">
              <span className="lph-appt-when">
                {dayLabel(next.date, todayISO)}
                {next.time ? `, ${formatClock(next.time, timeFormat)}` : ""}
              </span>
              <span className="lph-appt-what">
                {next.event_type} · {next.status}
              </span>
            </span>
          </button>
          {address && (
            <a
              className="pl-round"
              href={mapsUrl(address)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Directions to the appointment"
            >
              <MobileIcon name="navigate" size={19} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
