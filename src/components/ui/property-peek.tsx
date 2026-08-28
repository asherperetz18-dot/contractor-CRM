"use client";

import { useEffect, useState } from "react";
import { mapsUrl } from "@/lib/data/types";
import {
  fetchPropertyReport,
  getPropertyReport,
  type PropertyReport,
} from "@/lib/actions/property-intel";

/**
 * A look at the property from its address: a Street View photo (the
 * Maps key already on this app powers it), a Zillow deep link, and --
 * when PropertyRadar is connected -- the recorded owner, value, equity
 * and chain of title.
 *
 * Every PropertyRadar search bills a credit, so nothing is fetched
 * automatically: cached reports load free, and a fresh pull takes a
 * deliberate two-click confirmation that names the cost.
 */

function dollars(n: number | null): string {
  return n === null ? "—" : `$${n.toLocaleString("en-US")}`;
}

/**
 * "TREJO,GEORGE M" against "George & Gabriela -": how many words of the
 * contact's name appear in the recorded owner. All of them is a match,
 * some is a maybe, none is the warning this feature exists for.
 */
function ownerMatch(owner: string | null, contactName: string | null) {
  if (!owner || !contactName) return null;
  const ownerLc = owner.toLowerCase();
  const words = contactName
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2);
  if (!words.length) return null;
  const hits = words.filter((w) => ownerLc.includes(w)).length;
  if (hits === words.length) return "match" as const;
  if (hits > 0) return "partial" as const;
  return "different" as const;
}

export function PropertyPeek({
  address,
  leadId,
  contactName,
}: {
  address: string;
  /** When present, the PropertyRadar report section renders. */
  leadId?: string;
  contactName?: string | null;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [report, setReport] = useState<PropertyReport | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [armed, setArmed] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [showChain, setShowChain] = useState(false);
  const [error, setError] = useState("");

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const zillowUrl = `https://www.zillow.com/homes/${encodeURIComponent(address)}_rb/`;

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    getPropertyReport(leadId).then((r) => {
      if (cancelled || r.error) return;
      setReport(r.report ?? null);
      setConfigured(!!r.configured);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  async function pull() {
    if (!leadId) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setPulling(true);
    setError("");
    const result = await fetchPropertyReport(leadId);
    setPulling(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setReport(result.report ?? null);
  }

  const match = report ? ownerMatch(report.owner, contactName ?? null) : null;
  // The records that matter for "any loan or lien": everything except
  // plain ownership transfers.
  const chain = (report?.transactions ?? []).filter(
    (t) => t.DocTypeUI && !/deed/i.test(t.DocTypeUI)
  );

  return (
    <div className="field property-peek">
      <span className="field-label">Property</span>
      {key && !imgFailed && (
        <a href={mapsUrl(address)} target="_blank" rel="noopener noreferrer" title="Open in Google Maps">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://maps.googleapis.com/maps/api/streetview?size=400x180&location=${encodeURIComponent(address)}&source=outdoor&key=${key}`}
            alt={`Street view of ${address}`}
            className="property-peek-img"
            onError={() => setImgFailed(true)}
          />
        </a>
      )}
      <a
        className="property-peek-zillow"
        href={zillowUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        View on Zillow — property &amp; value →
      </a>

      {/* The slot is held open while the cached-report check runs --
          rendering it only after the answer arrived shoved the fields
          below it down a beat after the drawer painted. */}
      {leadId && !loaded && <div className="property-intel property-intel-loading" />}
      {leadId && loaded && configured && (
        <div className="property-intel">
          {report ? (
            <>
              <div className="property-intel-row">
                <span className="property-intel-owner">👤 {report.owner || "Owner unknown"}</span>
                {match === "match" && (
                  <span className="pi-badge pi-badge-ok">✓ Owner matches contact</span>
                )}
                {match === "partial" && (
                  <span className="pi-badge pi-badge-warn">≈ Partial name match — verify</span>
                )}
                {match === "different" && (
                  <span className="pi-badge pi-badge-bad">
                    ⚠ Different name — verify before contract
                  </span>
                )}
              </div>
              <div className="property-intel-figures">
                <span>Value {dollars(report.avm)}</span>
                <span>Equity {dollars(report.available_equity)}
                  {report.equity_percent !== null ? ` (${report.equity_percent}%)` : ""}
                </span>
                <span>Loans {dollars(report.total_loan_balance)}</span>
              </div>
              {(report.in_foreclosure || report.listed_for_sale) && (
                <div className="property-intel-flags">
                  {report.in_foreclosure && (
                    <span className="pi-badge pi-badge-bad">In foreclosure</span>
                  )}
                  {report.listed_for_sale && (
                    <span className="pi-badge pi-badge-warn">Listed for sale</span>
                  )}
                </div>
              )}
              {chain.length > 0 && (
                <button
                  type="button"
                  className="btn-ghost small"
                  onClick={() => setShowChain((v) => !v)}
                >
                  {showChain ? "Hide" : "Show"} loans &amp; liens ({chain.length})
                </button>
              )}
              {showChain && (
                <ul className="property-intel-chain">
                  {chain.map((t, i) => (
                    <li key={i}>
                      <span className="mono">{t.RecDate ?? "—"}</span> {t.DocTypeUI}
                      {t.Purpose ? ` · ${t.Purpose}` : ""}
                      {t.Amount ? ` · $${t.Amount.toLocaleString("en-US")}` : ""}
                      {t.Grantee ? ` · ${t.Grantee}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <p className="property-intel-meta">
                PropertyRadar · pulled{" "}
                {new Date(report.fetched_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
                {" · "}
                <button type="button" className="pi-refresh" onClick={pull} disabled={pulling}>
                  {pulling ? "Refreshing…" : armed ? "Confirm — bills 1 search" : "Refresh (1 credit)"}
                </button>
              </p>
            </>
          ) : (
            <button
              type="button"
              className="btn-ghost small"
              onClick={pull}
              disabled={pulling}
            >
              {pulling
                ? "Checking county records…"
                : armed
                  ? "Confirm — bills 1 PropertyRadar search"
                  : "🔎 Check owner & liens (1 credit)"}
            </button>
          )}
          {error && <p className="error-note">{error}</p>}
        </div>
      )}
    </div>
  );
}
