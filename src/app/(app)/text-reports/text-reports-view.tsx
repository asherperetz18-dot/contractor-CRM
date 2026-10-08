"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { requestsAddress } from "@/lib/report-address";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { DateRangeFilter, type RangeState } from "@/components/date-range-filter";
import { resolveWindow, withinWindow } from "@/lib/data/date-range";
import { leadDisplayName, normalizePhone, type LeadLite } from "@/lib/data/types";
import {
  TEXT_REPORT_PRESETS,
  TEXT_REPORT_ROWS,
  parseTextReportQuery,
  textReportQueryString,
  textReportRange,
  type TextReportQuery,
  type TextReportRow,
} from "@/lib/text-reports-window";

type DirectionFilter = "All" | "outbound" | "inbound";

const PRESETS = [...TEXT_REPORT_PRESETS];

// Replies the SMS webhook treats as an appointment confirmation/decline --
// surfaced here so it's obvious at a glance which inbound texts actually
// moved an appointment, rather than just being conversation.
const YES_WORDS = new Set(["yes", "y", "confirm", "confirmed", "ok", "okay", "yeah", "yep", "sure"]);
const NO_WORDS = new Set(["no", "n", "cancel", "decline", "declined", "nope"]);

function replyKind(m: TextReportRow): "yes" | "no" | null {
  if (m.direction !== "inbound") return null;
  const b = m.body.trim().toLowerCase();
  if (YES_WORDS.has(b)) return "yes";
  if (NO_WORDS.has(b)) return "no";
  return null;
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

export function TextReportsView({
  query,
  messages,
  leads,
}: {
  query: TextReportQuery;
  messages: TextReportRow[];
  leads: LeadLite[];
}) {
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<DirectionFilter>("All");
  const [range, setRange] = useState<RangeState>(() => textReportRange(query));
  // Captured once at mount -- a "now" read during render would make the
  // date-range filter shift unpredictably across re-renders.
  const [now] = useState(() => Date.now());

  // The page loads only the period in the address (DECISIONS #146).
  // Changing it puts the new period there -- in a transition, so the
  // report stays on screen, faded, until the new texts arrive. Until
  // then the numbers stay on the period that's loaded, rather than
  // counting a part of the new one as if it were all of it.
  const router = useRouter();
  const [windowPending, startWindow] = useTransition();
  const wantedQs = textReportQueryString(
    parseTextReportQuery({ range: range.preset, from: range.from, to: range.to })
  );
  const loadedQs = textReportQueryString(query);
  // The address can also move without this report asking: the Daily
  // Brief opens from the top bar on this very page, and its Texts tile
  // links here. Follow it, rather than sending it back to the old period
  // (adjusting state from a prop, during render, as React advises).
  const [seenQs, setSeenQs] = useState(loadedQs);
  if (seenQs !== loadedQs) {
    setSeenQs(loadedQs);
    if (loadedQs !== wantedQs) setRange(textReportRange(query));
  }
  // The address this view last asked for, so its own request arriving
  // isn't taken for a link -- and going back to the loaded period while
  // another is on its way still asks, so the router drops that one.
  const asked = useRef(loadedQs);
  const loadedBefore = useRef(loadedQs);
  useEffect(() => {
    const followed = loadedQs !== loadedBefore.current;
    loadedBefore.current = loadedQs;
    const ask = requestsAddress({
      wanted: wantedQs,
      loaded: loadedQs,
      sent: asked.current,
      pending: windowPending,
      followed,
    });
    asked.current = wantedQs;
    if (ask) {
      startWindow(() => router.replace(`/text-reports${wantedQs}`, { scroll: false }));
    }
  }, [wantedQs, loadedQs, windowPending, router]);
  const loading = windowPending || wantedQs !== loadedQs;
  const loadedRange = useMemo(() => textReportRange(query), [query]);
  const shownRange = loading ? loadedRange : range;

  const leadById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);

  // Inbound texts from someone who isn't linked to a lead still need a
  // name where we have one -- match on the sender's number.
  const leadByPhone = useMemo(() => {
    const map = new Map<string, LeadLite>();
    for (const l of leads) {
      if (l.phone) map.set(normalizePhone(l.phone), l);
      if (l.second_contact_phone) map.set(normalizePhone(l.second_contact_phone), l);
    }
    return map;
  }, [leads]);

  function contactFor(m: TextReportRow): LeadLite | null {
    if (m.lead_id) return leadById.get(m.lead_id) ?? null;
    const other = m.direction === "inbound" ? m.from_number : m.to_number;
    return leadByPhone.get(normalizePhone(other)) ?? null;
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const win = resolveWindow(shownRange, new Date(now));
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
  }, [messages, direction, shownRange, search, now, leadById, leadByPhone]);

  // The table draws a page of rows at a time -- a busy month is thousands
  // of texts -- while the numbers above it count them all. Another filter
  // starts again from one page.
  const filterSig = `${search}|${direction}|${wantedQs}`;
  const [more, setMore] = useState({ sig: filterSig, count: TEXT_REPORT_ROWS });
  const shownCount = more.sig === filterSig ? more.count : TEXT_REPORT_ROWS;

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

      <div className={"text-reports-body" + (loading ? " is-loading" : "")} aria-busy={loading}>
        {rows.length === 0 ? (
          <div className="empty-state">
            <p className="empty-label">{loading ? "Loading…" : "No texts yet"}</p>
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
                {rows.slice(0, shownCount).map((m) => {
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
        {rows.length > shownCount && (
          <div className="text-reports-more">
            <span className="empty-hint">
              Showing {shownCount} of {rows.length} texts
            </span>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setMore({ sig: filterSig, count: shownCount + TEXT_REPORT_ROWS })}
            >
              Show more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
