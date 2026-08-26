"use client";

import { useEffect, useState } from "react";
import { analyzeLeadConversation, getLeadAnalysis } from "@/lib/actions/lead-analysis";
import type { LeadAnalysis } from "@/lib/data/ai-analysis";

/**
 * The analyzer's readout on the contact card's Overview tab.
 *
 * Renders nothing at all while the feature is switched off and no
 * analysis exists -- a dead button teaches people to stop looking. Once
 * an analysis exists it stays visible even if the feature is later
 * disabled: it's a record someone made, not a live promise.
 */
export function LeadAnalysisPanel({ leadId }: { leadId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [analysis, setAnalysis] = useState<LeadAnalysis | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getLeadAnalysis(leadId).then((r) => {
      if (cancelled || r.error) return;
      setEnabled(!!r.enabled);
      setAnalysis(r.analysis ?? null);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  async function run() {
    setRunning(true);
    setError("");
    const result = await analyzeLeadConversation(leadId);
    setRunning(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setAnalysis(result.analysis ?? null);
  }

  if (!loaded || (!enabled && !analysis)) return null;

  const counts = analysis?.source_counts;
  const countLine = counts
    ? [
        counts.texts ? `${counts.texts} texts` : "",
        counts.calls ? `${counts.calls} calls` : "",
        counts.notes ? `${counts.notes} notes` : "",
        counts.appointments ? `${counts.appointments} appts` : "",
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <div className="second-contact-block ai-analysis-block">
      <div className="second-contact-head">
        <span>
          🧠 AI Analysis
          {analysis && (
            <span className={`ai-temp ai-temp-${analysis.temperature.toLowerCase()}`}>
              {analysis.temperature}
            </span>
          )}
        </span>
        {enabled && (
          <button type="button" className="btn-ghost small" onClick={run} disabled={running}>
            {running ? "Reading the conversation…" : analysis ? "Analyze again" : "Analyze"}
          </button>
        )}
      </div>

      {error && <p className="error-note">{error}</p>}

      {analysis ? (
        <>
          <p className="ai-analysis-summary">{analysis.summary}</p>
          {analysis.positive_signals.length > 0 && (
            <ul className="ai-signal-list">
              {analysis.positive_signals.map((s, i) => (
                <li key={i} className="ai-signal-pos">
                  <strong>✓ {s.signal}</strong>
                  {s.evidence ? <span> — {s.evidence}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {analysis.negative_signals.length > 0 && (
            <ul className="ai-signal-list">
              {analysis.negative_signals.map((s, i) => (
                <li key={i} className="ai-signal-neg">
                  <strong>✗ {s.signal}</strong>
                  {s.evidence ? <span> — {s.evidence}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {analysis.next_step && (
            <p className="ai-analysis-next">
              <strong>Suggested next step:</strong> {analysis.next_step}
            </p>
          )}
          <p className="ai-analysis-meta">
            Analyzed {new Date(analysis.analyzed_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            {countLine ? ` from ${countLine}` : ""} · AI can misread — trust the conversation
            over the summary
          </p>
        </>
      ) : (
        <p className="hint-note">
          Reads this contact&apos;s texts, calls, notes, and appointments, then reports the
          buying signals it finds.
        </p>
      )}
    </div>
  );
}
