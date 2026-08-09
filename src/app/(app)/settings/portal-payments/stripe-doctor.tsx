"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moneyCents } from "@/lib/data/types";
import {
  stripeDiagnostics,
  reconcilePendingPayments,
  type StripeDiagnostics,
} from "@/lib/actions/stripe-admin";

const APP_WEBHOOK_PATHS = ["/api/stripe/webhook"];

/**
 * Reads back what Stripe is actually configured to do.
 *
 * A payment that never arrives looks identical from inside this app
 * whether the customer abandoned checkout or the webhook never reached
 * us -- both leave a pending row and nothing else. ACH makes that worse:
 * it settles days later, so the webhook is the only thing that will ever
 * report it. This asks Stripe directly instead of guessing.
 */
export function StripeDoctor() {
  const router = useRouter();
  const [diag, setDiag] = useState<StripeDiagnostics | null>(null);
  const [notes, setNotes] = useState<string[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setNotes(null);
    startTransition(async () => setDiag(await stripeDiagnostics()));
  }

  function sync() {
    setNotes(null);
    startTransition(async () => {
      const res = await reconcilePendingPayments();
      if (res.error) return setSummary(res.error);
      setSummary(`Checked ${res.checked ?? 0}, updated ${res.updated ?? 0}.`);
      setNotes(res.notes ?? []);
      setDiag(await stripeDiagnostics());
      router.refresh();
    });
  }

  const pointsHere = (url: string) =>
    APP_WEBHOOK_PATHS.some((p) => url.includes(p)) && url.includes("aibuildpros.com");

  return (
    <section className="est-pay">
      <div className="est-pay-head">
        <div>
          <h2 className="est-pay-title">Stripe connection check</h2>
          <p className="est-pay-sub">
            What Stripe is set up to do, and what it says about payments still pending here.
          </p>
        </div>
        <div className="est-pay-actions">
          <button className="btn-ghost" onClick={run} disabled={pending}>
            {pending ? "Checking…" : "Run check"}
          </button>
          <button className="btn-primary" onClick={sync} disabled={pending}>
            Sync payments from Stripe
          </button>
        </div>
      </div>

      {summary && <p className="hint-note">{summary}</p>}
      {notes && notes.length > 0 && (
        <ul className="pp-notes">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      {diag && (
        <>
          {diag.error && <p className="error-note">{diag.error}</p>}

          {diag.configured && (
            <ul className="pp-checks">
              <li>
                <strong>{diag.keyMode === "live" ? "Live" : "Test"} mode</strong> — secret key is
                set{diag.keyMode === "test" && ", so no real money moves yet"}.
              </li>
              <li className={diag.webhookSecretSet ? "" : "pp-bad"}>
                Signing secret {diag.webhookSecretSet ? "is set" : "is MISSING — payments cannot be recorded"}.
              </li>
              <li className={diag.achEnabled === false ? "pp-bad" : ""}>
                ACH Direct Debit on the <strong>default</strong> configuration:{" "}
                {diag.achEnabled === null
                  ? "unknown"
                  : diag.achEnabled
                    ? "on"
                    : "OFF — this is the one Checkout uses, so ACH will not appear"}
                .
              </li>
              {/* An account can hold several configurations and the
                  Dashboard deep-links to whichever was last opened, so
                  "I enabled ACH" and "ACH is off at checkout" are both
                  true when the toggle was flipped on a non-default one. */}
              {diag.configs.map((c) => (
                <li key={c.id} className={c.isDefault && c.ach !== "on" ? "pp-bad" : ""}>
                  <span className="mono">{c.name}</span>
                  {c.isDefault ? " (DEFAULT — used by checkout)" : " (not default — ignored)"} · ACH{" "}
                  <strong>{c.ach}</strong> · card {c.card}
                  <div className="ur-add-phone mono">{c.id}</div>
                </li>
              ))}
              {/* The whole point of the panel: an ACH payment settles days
                  later and is reported only by webhook, so a missing or
                  wrong endpoint loses it silently. */}
              {diag.endpoints.length === 0 ? (
                <li className="pp-bad">
                  <strong>No webhook endpoint is configured at Stripe.</strong> Card payments will
                  look like they worked and never be recorded; ACH will never arrive at all.
                </li>
              ) : (
                diag.endpoints.map((e) => (
                  <li key={e.url} className={e.status === "enabled" && pointsHere(e.url) && e.missingEvents.length === 0 ? "" : "pp-bad"}>
                    <span className="mono">{e.url}</span> — {e.status}
                    {!pointsHere(e.url) && " · does not point at this app"}
                    {e.missingEvents.length > 0 && (
                      <> · missing events: <span className="mono">{e.missingEvents.join(", ")}</span></>
                    )}
                  </li>
                ))
              )}
            </ul>
          )}

          {diag.pending.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th className="right">Amount</th>
                  <th>At Stripe</th>
                  <th>What it means</th>
                </tr>
              </thead>
              <tbody>
                {diag.pending.map((p, i) => (
                  <tr key={i}>
                    <td className="mono">{p.docNumber}</td>
                    <td className="right mono">{moneyCents(p.amountCents)}</td>
                    <td>
                      {p.sessionStatus}/{p.paymentStatus}
                      {p.methodTypes.length > 0 && (
                        <div className="ur-add-phone">{p.methodTypes.join(", ")}</div>
                      )}
                    </td>
                    <td>{p.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {diag.configured && diag.pending.length === 0 && !diag.error && (
            <p className="hint-note">Nothing is pending — every payment is settled or closed.</p>
          )}
        </>
      )}
    </section>
  );
}
