"use client";

import { useEffect, useState } from "react";
import { recordAndListLeadViews, type LeadView } from "@/lib/actions/lead-views";

function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const stamp = d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return stamp;
}

export function LeadViewTrail({ leadId, isAdmin }: { leadId: string; isAdmin: boolean }) {
  const [views, setViews] = useState<LeadView[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // One trip: record this open and get the trail back together.
      // This used to be two sequential server actions, each of which
      // also re-rendered the page underneath -- a one-line bar costing
      // two full page renders and arriving seconds late.
      const result = await recordAndListLeadViews(leadId);
      if (cancelled || !isAdmin) return;
      setViews(result.views ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, isAdmin]);

  if (!isAdmin) return null;
  // The bar's space is reserved from the first frame. Rendering nothing
  // until the data landed made the whole form jump down 45px when the
  // bar finally arrived -- for an admin it always renders something, so
  // holding its slot open costs nothing and the layout never moves.
  if (views === null) {
    return <p className="lead-trail lead-trail-loading">👁 &nbsp;</p>;
  }
  if (views.length === 0) {
    return <p className="lead-trail">👁 No one has opened this lead yet.</p>;
  }

  const [latest, ...rest] = views;
  return (
    <div className="lead-trail">
      <span>
        👁 Last opened by <strong>{latest.name}</strong> · {whenLabel(latest.openedAt)}
      </span>
      {rest.length > 0 && (
        <button type="button" className="lead-trail-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide history" : `${rest.length} earlier`}
        </button>
      )}
      {expanded && (
        <ul className="lead-trail-list">
          {rest.map((v) => (
            <li key={v.id}>
              <span>{v.name}</span>
              <span className="lead-trail-when">{whenLabel(v.openedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
