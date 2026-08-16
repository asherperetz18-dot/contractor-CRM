"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DateRangeFilter, type RangeState } from "@/components/date-range-filter";
import { resolveWindow, withinWindow } from "@/lib/data/date-range";
import { leadDisplayName, normalizePhone, type Lead, type SmsMessage } from "@/lib/data/types";

type DirectionFilter = "All" | "outbound" | "inbound";

const PRESETS = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
  { key: "all", label: "All time" },
];

// Replies the SMS webhook treats as an appointment confirmation/decline --
// surfaced here so it's obvious at a glance which inbound texts actually
// moved an appointment, rather than just being conversation.
const YES_WORDS = new Set(["yes", "y", "confirm", "confirmed", "ok", "okay", "yeah", "yep", "sure"]);
const NO_WORDS = new Set(["no", "n", "cancel", "decline", "declined", "nope"]);

function replyKind(m: SmsMessage): "yes" | "no" | null {
  if (m.direction !== "inbound") return null;
  const b = m.body.trim().toLowerCase();
  if (YES_WORDS.has(b)) return "yes";
  if (NO_WORDS.has(b)) return "no";
  return null;
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

export function TextReportsView({ messages, leads }: { messages: SmsMessage[]; leads: Lead[] }) {
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<DirectionFilter>("All");
  const [range, setRange] = useState<RangeState>({ preset: "30", from: "", to: "" });
  // Captured once at mount -- a "now" read during render would make the
  // date-range filter shift unpredictably across re-renders.
  const [now] = useState(() => Date.now());

  const leadById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);

  // Inbound texts from someone who isn't linked to a lead still need a
  // name where we have one -- match on the sender's number.
  const leadByPhone = useMemo(() => {
    const map = new Map<string, Lead>();
    for (const l of leads) {
      if (l.phone) map.set(normalizePhone(l.phone), l);
      if (l.second_contact_phone) map.set(normalizePhone(l.second_contact_phone), l);
    }
    return map;
  }, [leads]);

  function contactFor(m: SmsMessage): Lead | null {
    if (m.lead_id) return leadById.get(m.lead_id) ?? null;
    const other = m.direction === "inbound" ? m.from_number : m.to_number;
    return leadByPhone.get(normalizePhone(other)) ?? null;
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const win = resolveWindow(range, new Date(now));
    return messages.filter((m) => {
      if (direction !== "All" && m.direction !== direction) return false;
      if (!withinWindow(m.created_at, win)) return false;
      if (!q) return true;
      const lead = contactFor(m);
      const name = lead ? leadDisplayName(lead).toLowerCase() : "";
      return (
        name.includes(q) ||
        m.body.toLowerCase().includes(q) ||
        m.from_number.toLowerCase().includes(q) ||
        m.to_number.toLowerCase().includes(q)
      );
    });
    // contactFor is derived from the same inputs the memo already tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, direction, range, search, now, leadById, leadByPhone]);

  const sent = rows.filter((m) => m.direction === "outbound").length;
  const received = rows.filter((m) => m.direction === "inbound").length;
  const confirmations = rows.filter((m) => replyKind(m) === "yes").length;
  const declines = rows.filter((m) => replyKind(m) === "no").length;

  // A conversation counts as replied-to if the contact texted back at all.
  const repliedContacts = new Set(
    rows.filter((m) => m.direction === "inbound").map((m) => normalizePhone(m.from_number))
  );
  const textedContacts = new Set(
    rows.filter((m) => m.direction === "outbound").map((m) => normalizePhone(m.to_number))
  );
  const replyRate = textedContacts.size
    ? Math.round(
        ([...textedContacts].filter((p) => repliedContacts.has(p)).length / textedContacts.size) *
          100
      )
    : 0;

  const busiestDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of rows) counts.set(dayKey(m.created_at), (counts.get(dayKey(m.created_at)) ?? 0) + 1);
    let best: [string, number] | null = null;
    for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
    return best;
  }, [rows]);

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Text Reports</h1>
          <p className="module-sub">
            Every SMS sent and received, including appointment confirmations texted back by reps and
            clients
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{sent}</div>
          <div className="stat-label">Texts Sent</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{received}</div>
          <div className="stat-label">Replies Received</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{replyRate}%</div>
          <div className="stat-label">Reply Rate</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">
            {confirmations}
            {declines > 0 && <span style={{ opacity: 0.5 }}> / {declines}</span>}
          </div>
          <div className="stat-label">Confirmed{declines > 0 ? " / Declined" : ""}</div>
        </div>
      </div>

      <div className="filter-bar">
        <input
          className="ur-search"
          style={{ maxWidth: 320, marginBottom: 0 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search message, name, or phone…"
        />
        <select value={direction} onChange={(e) => setDirection(e.target.value as DirectionFilter)}>
          <option value="All">All Messages</option>
          <option value="outbound">Sent</option>
          <option value="inbound">Received</option>
        </select>
        <DateRangeFilter
          variant="select"
          presets={PRESETS}
          value={range}
          onChange={setRange}
          max={new Date(now).toISOString().slice(0, 10)}
        />
      </div>

      {busiestDay && (
        <p className="empty-hint" style={{ marginTop: 0 }}>
          Busiest day in this range: {new Date(`${busiestDay[0]}T00:00:00`).toLocaleDateString(
            "en-US",
            { weekday: "short", month: "short", day: "numeric" }
          )}{" "}
          ({busiestDay[1]} messages)
        </p>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">No texts yet</p>
          <p className="empty-hint">
            Messages sent from the Reply Inbox, appointment reminders, and rep info texts will show
            up here.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date/Time</th>
                <th>Direction</th>
                <th>Contact</th>
                <th>Phone</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const lead = contactFor(m);
                const other = m.direction === "inbound" ? m.from_number : m.to_number;
                const kind = replyKind(m);
                return (
                  <tr key={m.id}>
                    <td>{new Date(m.created_at).toLocaleString()}</td>
                    <td>
                      <Badge color={m.direction === "inbound" ? "#2F855A" : "#2D5F8A"}>
                        {m.direction === "inbound" ? "Received" : "Sent"}
                      </Badge>
                      {kind && (
                        <span style={{ marginLeft: 6 }}>
                          <Badge color={kind === "yes" ? "#2F855A" : "#C0392B"}>
                            {kind === "yes" ? "✓ Confirmed" : "✕ Declined"}
                          </Badge>
                        </span>
                      )}
                    </td>
                    <td>{lead ? leadDisplayName(lead) : "—"}</td>
                    <td className="mono">{other}</td>
                    <td style={{ whiteSpace: "pre-wrap", maxWidth: 420 }}>{m.body}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
