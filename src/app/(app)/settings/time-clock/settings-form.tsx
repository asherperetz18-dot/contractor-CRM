"use client";

import { useState, useTransition } from "react";
import { saveTimeClockSettings } from "@/lib/actions/time-clock";
import { CLOCK_ROLES, type TimeClockSettings } from "@/lib/time-clock/settings";
import { AddressAutocompleteInput } from "@/components/ui/address-autocomplete-input";

export function TimeClockSettingsForm({ initial }: { initial: TimeClockSettings }) {
  const [roles, setRoles] = useState<string[]>(initial.tracked_roles);
  const [radius, setRadius] = useState(String(initial.zone_radius_m));
  const [overtime, setOvertime] = useState(String(initial.overtime_weekly_hours));
  const [late, setLate] = useState(String(initial.late_after_min));
  const [autoOut, setAutoOut] = useState(String(initial.auto_clock_out_hours));
  const [retention, setRetention] = useState(String(initial.trail_retention_days));
  const [office, setOffice] = useState(initial.office_address ?? "");
  const [message, setMessage] = useState<{ error?: string; ok?: boolean }>({});
  const [pending, startTransition] = useTransition();

  function save() {
    setMessage({});
    startTransition(async () => {
      setMessage(
        await saveTimeClockSettings({
          tracked_roles: roles,
          zone_radius_m: radius,
          overtime_weekly_hours: overtime,
          late_after_min: late,
          auto_clock_out_hours: autoOut,
          trail_retention_days: retention,
          office_address: office,
        })
      );
    });
  }

  return (
    <div className="tc-settings">
      <section className="tc-card">
        <h2 className="tc-h2">Who clocks in &amp; is tracked</h2>
        <div className="chip-row">
          {CLOCK_ROLES.map((r) => (
            <label key={r} className="tc-check">
              <input
                type="checkbox"
                checked={roles.includes(r)}
                onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))}
              />
              {r}
            </label>
          ))}
        </div>
        <p className="hint-note">
          Location is shared only while someone is on the clock, and stops on clock-out and during breaks. Each person
          accepts a notice before their first clock-in.
        </p>
      </section>

      <section className="tc-card">
        <h2 className="tc-h2">Job zones</h2>
        <label className="field">
          <span className="field-label">Zone radius around each appointment address (metres)</span>
          <input type="number" min={30} max={1000} value={radius} onChange={(e) => setRadius(e.target.value)} />
        </label>
        <p className="hint-note">Phone GPS drifts 10–50 m; under 100 m misses honest arrivals. 150 m suits most jobs.</p>
        <label className="field">
          <span className="field-label">Office address (shows people as &ldquo;In the office&rdquo;)</span>
          <AddressAutocompleteInput value={office} onChange={setOffice} placeholder="Street, city, state" />
        </label>
      </section>

      <section className="tc-card">
        <h2 className="tc-h2">Hours &amp; attendance</h2>
        <label className="field">
          <span className="field-label">Overtime after (hours a week)</span>
          <input type="number" min={1} max={80} value={overtime} onChange={(e) => setOvertime(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Late after (minutes past the appointment start)</span>
          <input type="number" min={0} max={240} value={late} onChange={(e) => setLate(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Clock out automatically after (hours) — flagged on Timesheets</span>
          <input type="number" min={1} max={24} value={autoOut} onChange={(e) => setAutoOut(e.target.value)} />
        </label>
      </section>

      <section className="tc-card">
        <h2 className="tc-h2">Privacy</h2>
        <label className="field">
          <span className="field-label">Keep location trails for (days)</span>
          <input type="number" min={7} max={730} value={retention} onChange={(e) => setRetention(e.target.value)} />
        </label>
        <p className="hint-note">Hours and job arrivals are kept for payroll; the map trail is deleted after this.</p>
      </section>

      <div className="chip-row">
        <button type="button" className="btn-primary" disabled={pending} onClick={save}>
          Save
        </button>
        {message.ok && <span className="tc-soft">Saved.</span>}
        {message.error && <span className="error-note">{message.error}</span>}
      </div>
    </div>
  );
}
