"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLeadTouches, type LeadTouch } from "@/lib/actions/lead-touches";
import { TOUCH_LABEL } from "@/lib/data/types";

const KIND_COLOR: Record<LeadTouch["kind"], string> = {
  opened: "#7C8798",
  note: "#2d5f8a",
  task: "#c0730f",
  appointment: "#2f855a",
  call: "#6b46c1",
  text: "#0f766e",
};

export function LeadsTouched({
  userId,
  userName,
  sinceISO,
}: {
  userId: string;
  userName: string;
  sinceISO: string;
}) {
  const [touches, setTouches] = useState<LeadTouch[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getLeadTouches(userId, sinceISO);
      if (cancelled) return;
      if (result.error) setError(result.error);
      setTouches(result.touches ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, sinceISO]);

  return (
    <>
      <h4 className="ta-drill-title">Leads Touched — {userName}</h4>
      {error && <p className="error-note">{error}</p>}
      {touches === null && <p className="empty-hint">Loading…</p>}
      {touches !== null && touches.length === 0 && !error && (
        <p className="empty-hint">
          No leads touched in this range. Lead opens only started being recorded recently, so
          older ranges will show little here.
        </p>
      )}
      {touches !== null && touches.length > 0 && (
        <table className="data-table ta-drill-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Contact</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {touches.map((t) => (
              <tr key={t.id}>
                <td className="ta-nowrap">
                  {new Date(t.at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </td>
                <td>
                  <span className="touch-tag" style={{ background: KIND_COLOR[t.kind] }}>
                    {TOUCH_LABEL[t.kind]}
                  </span>
                </td>
                <td>
                  <Link href={`/pipeline?leadId=${t.leadId}`} className="ur-crumb-link">
                    {t.leadName}
                  </Link>
                </td>
                <td className="touch-detail">{t.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
