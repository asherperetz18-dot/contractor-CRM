"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { completeLeadTask } from "@/lib/actions/leads";
import { groupTasksByDue } from "@/lib/data/lead-task-groups";
import { leadDisplayName, type ContactType } from "@/lib/data/types";

export type TaskRow = {
  id: string;
  lead_id: string;
  title: string;
  due_date: string;
  assigned_to: string | null;
  lead: {
    id: string;
    contact_type: ContactType;
    company_name: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    stage: string;
    assigned_to: string | null;
  };
};

const UPCOMING_SHOWN = 100;

function daysLate(due: string, today: string): number {
  return Math.round(
    (new Date(`${today}T00:00:00`).getTime() - new Date(`${due}T00:00:00`).getTime()) / 86400000
  );
}

function dueLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return isNaN(d.getTime())
    ? day
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Section({
  title,
  hint,
  rows,
  today,
  repNames,
  canComplete,
  onDone,
  pendingId,
  onOpen,
  urgent,
  attention,
  defaultOpen,
  totalCount,
}: {
  title: string;
  hint: string;
  rows: TaskRow[];
  today: string;
  repNames: Record<string, string>;
  canComplete: boolean;
  onDone: (id: string) => void;
  pendingId: string | null;
  onOpen: (leadId: string) => void;
  urgent?: boolean;
  attention?: boolean;
  defaultOpen?: boolean;
  /** When the section shows fewer rows than exist. */
  totalCount?: number;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const count = totalCount ?? rows.length;

  return (
    <div
      className={
        "dash-panel" +
        (urgent && count > 0 ? " digest-urgent" : "") +
        (attention && !urgent && count > 0 ? " digest-attention" : "")
      }
      style={{ marginBottom: 14 }}
    >
      <div
        className="digest-toggle"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <div className="cp-tz-head">
          <span>
            {title}{" "}
            <span
              className={
                "count-pill" +
                (urgent && count > 0 ? " count-pill-urgent" : "") +
                (attention && !urgent && count > 0 ? " count-pill-attention" : "")
              }
            >
              {count}
            </span>
          </span>
          <span className="filter-label">{open ? "▲" : "▼"}</span>
        </div>
        <p className="module-sub" style={{ margin: "4px 0 0" }}>
          {hint}
        </p>
      </div>
      {open &&
        (rows.length === 0 ? (
          <p className="empty-hint">Nothing here.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Contact</th>
                  <th>Phone</th>
                  <th>Pipeline Stage</th>
                  <th>Assigned To</th>
                  <th>Due</th>
                  {canComplete && <th className="right">Mark</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const late = daysLate(r.due_date, today);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => onOpen(r.lead_id)}
                      title="Open this contact"
                    >
                      <td>{r.title || "Follow up"}</td>
                      <td>{leadDisplayName(r.lead)}</td>
                      <td className="mono">{r.lead.phone || "—"}</td>
                      <td>{r.lead.stage}</td>
                      <td>
                        {repNames[r.assigned_to ?? r.lead.assigned_to ?? ""] || "Unassigned"}
                      </td>
                      <td>
                        {dueLabel(r.due_date)}
                        {late > 0 && <span className="stale-tag" style={{ marginLeft: 8 }}>{late}d late</span>}
                      </td>
                      {canComplete && (
                        <td className="right">
                          <button
                            type="button"
                            className="btn-ghost small"
                            disabled={pendingId === r.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDone(r.id);
                            }}
                          >
                            {pendingId === r.id ? "Saving…" : "Done"}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      {open && totalCount !== undefined && totalCount > rows.length && (
        <p className="hint-note">
          Showing the next {rows.length.toLocaleString()} of {totalCount.toLocaleString()}.
        </p>
      )}
    </div>
  );
}

/**
 * Every open lead task, grouped against today. The Overdue section
 * counts exactly what the dashboard's "Overdue tasks" card counts, so
 * the number that was clicked is the number that appears.
 */
export function TasksView({
  rows: initialRows,
  repNames,
  today,
  canComplete,
}: {
  rows: TaskRow[];
  repNames: Record<string, string>;
  today: string;
  canComplete: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => groupTasksByDue(rows, today), [rows, today]);

  async function markDone(id: string) {
    setPendingId(id);
    setError(null);
    const result = await completeLeadTask(id);
    setPendingId(null);
    if (result.error) {
      setError("Couldn't mark that task done — your role may not have permission.");
      return;
    }
    // Gone from every section at once; the server revalidates too.
    setRows((cur) => cur.filter((r) => r.id !== id));
  }

  function openLead(leadId: string) {
    router.push(`/contacts?openLead=${leadId}&from=/tasks`);
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Tasks</h1>
          <p className="module-sub">
            Every open follow-up on your leads, oldest first — click a row to open the contact.
          </p>
        </div>
      </div>

      {error && <p className="hint-note">{error}</p>}

      <Section
        title="Overdue"
        hint="Due before today — the dashboard's Overdue Tasks number, itemized."
        rows={groups.overdue}
        today={today}
        repNames={repNames}
        canComplete={canComplete}
        onDone={markDone}
        pendingId={pendingId}
        onOpen={openLead}
        urgent
        defaultOpen
      />
      <Section
        title="Due Today"
        hint="On the hook for today."
        rows={groups.dueToday}
        today={today}
        repNames={repNames}
        canComplete={canComplete}
        onDone={markDone}
        pendingId={pendingId}
        onOpen={openLead}
        attention
        defaultOpen
      />
      <Section
        title="Coming Up"
        hint="Scheduled for later — nearest first."
        rows={groups.upcoming.slice(0, UPCOMING_SHOWN)}
        totalCount={groups.upcoming.length}
        today={today}
        repNames={repNames}
        canComplete={canComplete}
        onDone={markDone}
        pendingId={pendingId}
        onOpen={openLead}
      />
    </div>
  );
}
