"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { correctPunch } from "@/lib/actions/time-clock";

export type TimesheetPerson = {
  id: string;
  name: string;
  minutesByDay: Record<string, number>;
  totalMinutes: number;
  overtimeMinutes: number;
  onSiteMinutes: number;
  autoClosed: number;
  open: boolean;
  edited: boolean;
  late: number;
  missed: number;
  punches: {
    id: string;
    clockIn: string;
    clockOut: string;
    endReason: string | null;
    minutes: number;
    history: { when: string; who: string; reason: string; lines: string[] }[];
  }[];
};

const hrs = (mins: number) => (mins ? (mins / 60).toFixed(1) : "—");
const dayName = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

function PunchEditor({ punch, onDone }: { punch: TimesheetPerson["punches"][number]; onDone: () => void }) {
  const [clockIn, setClockIn] = useState(punch.clockIn);
  const [clockOut, setClockOut] = useState(punch.clockOut);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    setError("");
    startTransition(async () => {
      const res = await correctPunch({ punchId: punch.id, clockIn, clockOut, reason });
      if (res.error) return setError(res.error);
      onDone();
    });
  }

  return (
    <div className="tc-editor">
      <label className="field">
        <span className="field-label">Clock in</span>
        <input type="datetime-local" value={clockIn} onChange={(e) => setClockIn(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Clock out</span>
        <input type="datetime-local" value={clockOut} onChange={(e) => setClockOut(e.target.value)} />
      </label>
      <label className="field tc-editor-reason">
        <span className="field-label">Why (kept in the history)</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Forgot to clock out — left the site at 4:28" />
      </label>
      <button type="button" className="btn-primary small" disabled={pending} onClick={save}>
        Save
      </button>
      {error && <p className="error-note">{error}</p>}
    </div>
  );
}

export function TimesheetView({
  days,
  people,
  csv,
  overtimeHours,
}: {
  days: string[];
  people: TimesheetPerson[];
  csv: string;
  overtimeHours: number;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  function download() {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `timesheets-${days[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (people.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-label">No hours this week</p>
        <p className="empty-hint">Hours appear here as people clock in on the Time Clock.</p>
      </div>
    );
  }

  return (
    <div className="tc-sheet">
      <div className="chip-row tc-sheet-actions">
        <button type="button" className="btn-ghost" onClick={download}>
          Export for payroll (CSV)
        </button>
        <span className="tc-soft">Overtime after {overtimeHours} h a week. Click a person to see and fix their punches.</span>
      </div>
      <div className="tc-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Person</th>
              {days.map((d) => (
                <th key={d} className="right">
                  {dayName(d)}
                </th>
              ))}
              <th className="right">Total</th>
              <th className="right">On site</th>
              <th className="right">Late</th>
              <th>Needs a look</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <Fragment key={p.id}>
                <tr className="tc-row" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                  <td>
                    <button type="button" className="tc-link" aria-expanded={openId === p.id}>
                      {p.name}
                    </button>
                  </td>
                  {days.map((d) => (
                    <td key={d} className="right tc-mono">
                      {hrs(p.minutesByDay[d] ?? 0)}
                    </td>
                  ))}
                  <td className="right tc-mono">
                    <strong>{hrs(p.totalMinutes)}</strong>
                  </td>
                  <td className="right tc-mono">{hrs(p.onSiteMinutes)}</td>
                  <td className="right tc-mono">{p.late}</td>
                  <td>
                    <span className="chip-row">
                      {p.open && <span className="tc-chip tc-chip-driving">On the clock</span>}
                      {p.overtimeMinutes > 0 && <span className="tc-chip tc-chip-stopped">Overtime {hrs(p.overtimeMinutes)} h</span>}
                      {p.autoClosed > 0 && <span className="tc-chip tc-chip-no-signal">Missed clock-out ×{p.autoClosed}</span>}
                      {p.missed > 0 && <span className="tc-chip tc-chip-no-signal">No-show ×{p.missed}</span>}
                      {p.edited && <span className="tc-chip tc-chip-office">Edited by office</span>}
                    </span>
                  </td>
                </tr>
                {openId === p.id && (
                  <tr>
                    <td colSpan={days.length + 5} className="tc-detail">
                      {p.punches.map((pu) => (
                        <div key={pu.id} className="tc-punch">
                          <div className="tc-line">
                            <span className="tc-mono">
                              {pu.clockIn.replace("T", " ")} → {pu.clockOut ? pu.clockOut.replace("T", " ") : "still open"}
                              {pu.endReason === "break" && " (break)"}
                              {pu.endReason === "auto" && " (auto clock-out)"}
                            </span>
                            <span className="chip-row">
                              <span className="tc-mono">{hrs(pu.minutes)} h</span>
                              <button type="button" className="btn-ghost small" onClick={() => setEditing(editing === pu.id ? null : pu.id)}>
                                {editing === pu.id ? "Cancel" : "Fix"}
                              </button>
                            </span>
                          </div>
                          {editing === pu.id && (
                            <PunchEditor
                              punch={pu}
                              onDone={() => {
                                setEditing(null);
                                router.refresh();
                              }}
                            />
                          )}
                          {pu.history.map((h, i) => (
                            <div key={i} className="tc-history">
                              {h.when} · {h.who} — {h.lines.join(" · ")} · &ldquo;{h.reason}&rdquo;
                            </div>
                          ))}
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint-note">Every change to hours is kept with who made it, when and why, and can&apos;t be deleted.</p>
    </div>
  );
}
