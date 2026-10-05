"use client";

import { useState, useTransition } from "react";
import { saveTimeClockSettings } from "@/lib/actions/time-clock";
import { CLOCK_ROLES, type ClockInCheckMode, type TimeClockSettings } from "@/lib/time-clock/settings";
import { AddressAutocompleteInput } from "@/components/ui/address-autocomplete-input";
import { STANDARD_ROLE_NAMES, roleName, type RoleNames } from "@/lib/role-names";

const CHECK_MODES: { value: ClockInCheckMode; label: string; hint: string }[] = [
  { value: "off", label: "Off", hint: "Where someone clocks in is saved but not checked." },
  { value: "record", label: "Record only", hint: "Flag off-site clock-ins on Timesheets. Nobody is asked anything." },
  {
    value: "ask",
    label: "Ask for a reason",
    hint: "Flag them, and ask the worker why when they clock in away from their jobs and the office.",
  },
];

// checkReady: migration 0185 has run, so the check has somewhere to keep
// its settings and verdicts.
export function TimeClockSettingsForm({
  initial,
  checkReady,
  roleNames = STANDARD_ROLE_NAMES,
}: {
  initial: TimeClockSettings;
  checkReady: boolean;
  /** What this company calls each role (DECISIONS #138); display only. */
  roleNames?: RoleNames;
}) {
  const [roles, setRoles] = useState<string[]>(initial.tracked_roles);
  const [radius, setRadius] = useState(String(initial.zone_radius_m));
  const [overtime, setOvertime] = useState(String(initial.overtime_weekly_hours));
  const [late, setLate] = useState(String(initial.late_after_min));
  const [autoOut, setAutoOut] = useState(String(initial.auto_clock_out_hours));
  const [retention, setRetention] = useState(String(initial.trail_retention_days));
  const [office, setOffice] = useState(initial.office_address ?? "");
  const [checkMode, setCheckMode] = useState<ClockInCheckMode>(initial.clock_in_check);
  const [checkRoles, setCheckRoles] = useState<string[]>(initial.check_roles);
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
          clock_in_check: checkMode,
          check_roles: checkRoles,
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
              {roleName(roleNames, r)}
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

      <section className="tc-card tc-settings-wide">
        <h2 className="tc-h2">Location check at clock-in</h2>
        <fieldset className="tc-fieldset" disabled={!checkReady}>
          <legend className="field-label">When someone clocks in away from their jobs and the office</legend>
          {CHECK_MODES.map((m) => (
            <label key={m.value} className="tc-radio">
              <input
                type="radio"
                name="clock_in_check"
                value={m.value}
                checked={checkMode === m.value}
                onChange={() => setCheckMode(m.value)}
              />
              <span>
                <strong>{m.label}</strong>
                <span className="tc-soft">{m.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="tc-fieldset" disabled={!checkReady || checkMode === "off"}>
          <legend className="field-label">Check these roles</legend>
          <div className="chip-row">
            {CLOCK_ROLES.map((r) => (
              <label key={r} className="tc-check">
                <input
                  type="checkbox"
                  checked={checkRoles.includes(r)}
                  onChange={(e) => setCheckRoles(e.target.checked ? [...checkRoles, r] : checkRoles.filter((x) => x !== r))}
                />
                {roleName(roleNames, r)}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="hint-note">
          {checkReady
            ? "Clock-ins are checked against the person's appointments that day, the production jobs they're on, and the office address above, using the zone radius. Clocking out is never questioned. Only roles that clock in (above) can be checked."
            : "Turns on once migration 0185_clock_in_check.sql has been run in Supabase."}
        </p>
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
