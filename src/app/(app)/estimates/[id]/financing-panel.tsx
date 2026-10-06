"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { centsFromInput, moneyCents } from "@/lib/data/types";
import { recordFinancingStatus, sendFinancingLink } from "@/lib/actions/financing";
import {
  FINANCING_STATUSES,
  FINANCING_STATUS_LABEL,
  currentFinancing,
  type FinancingEvent,
  type FinancingStatus,
} from "@/lib/financing";

export type FinancingStep = FinancingEvent & { id: string; channel: string | null; by: string | null };

export type FinancingPanelData = {
  /** The company's lender, when it has a link set (0214). */
  provider: string | null;
  steps: FinancingStep[];
  /** 0215 has run. */
  ready: boolean;
  /** Works estimates or records payments. */
  canWork: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
};

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const SENT_BY: Record<string, string> = { text: "by text", email: "by email", both: "by text and email" };

/**
 * Financing on this estimate (DECISIONS #162): send the customer the
 * lender's link, and keep track of where the application stands. The
 * lender's answer is entered here by hand; nothing comes back from it yet.
 */
export function FinancingPanel({ estimateId, data }: { estimateId: string; data: FinancingPanelData }) {
  const router = useRouter();
  const [status, setStatus] = useState<FinancingStatus>("applied");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const now = currentFinancing(data.steps);
  const withAmount = status === "approved" || status === "funded";
  const steps = [...data.steps].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  function send(channel: "text" | "email") {
    if (!window.confirm(`${channel === "text" ? "Text" : "Email"} the customer the link to apply with ${data.provider}?`)) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await sendFinancingLink({ estimateId, channel });
      if (res.sentBy) setMessage(`Sent by ${res.sentBy}.`);
      if (res.error) setError(res.error);
      router.refresh();
    });
  }

  function record() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await recordFinancingStatus({
        estimateId,
        status,
        amountCents: withAmount && amount.trim() ? centsFromInput(amount) : null,
        note,
      });
      if (res.error) return setError(res.error);
      setMessage(`Saved.${res.movedTo ? ` The lead moved to ${res.movedTo}.` : ""}`);
      setAmount("");
      setNote("");
      router.refresh();
    });
  }

  return (
    <section className="est-pay financing-panel">
      <h2 className="est-pay-title">
        Financing
        {now && (
          <span className={`est-badge est-badge-${now.status === "declined" ? "declined" : now.status === "funded" ? "signed" : "sent"}`}>
            {FINANCING_STATUS_LABEL[now.status]}
          </span>
        )}
      </h2>
      <p className="est-tax-note">
        {data.provider
          ? `The customer can apply with ${data.provider} from their customer page, or you can send them the link. Record what ${data.provider} tells you here; a customer who applies or is approved moves to Pending Finance.`
          : "There's no lender link set up (Settings › Customer Financing), so this only keeps track of where the customer's financing stands."}
      </p>
      {!data.ready && (
        <p className="error-note">
          Financing tracking needs a database update first: run 0215_estimate_financing.sql in Supabase.
        </p>
      )}

      {data.canWork && data.ready && data.provider && (
        <div className="est-pay-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={pending || !data.hasPhone}
            title={data.hasPhone ? "Text the customer the link" : "This customer has no phone number on file"}
            onClick={() => send("text")}
          >
            Text link
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={pending || !data.hasEmail}
            title={data.hasEmail ? "Email the customer the link" : "This customer has no email address on file"}
            onClick={() => send("email")}
          >
            Email link
          </button>
        </div>
      )}

      {data.canWork && data.ready && (
        <div className="financing-record">
          <label className="field">
            <span className="field-label">Where it stands</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as FinancingStatus)} disabled={pending}>
              {FINANCING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {FINANCING_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          {withAmount && (
            <label className="field">
              <span className="field-label">Amount (optional)</span>
              <input
                className="est-item-price"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                disabled={pending}
              />
            </label>
          )}
          <label className="field financing-note">
            <span className="field-label">Note (optional)</span>
            <input
              className="est-item-desc"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="e.g. Approved for the full amount"
              disabled={pending}
            />
          </label>
          <div className="est-pay-actions">
            <button type="button" className="btn-primary" onClick={record} disabled={pending}>
              {pending ? "Saving…" : "Record"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="error-note">{error}</p>}
      {message && <p className="hint-note">{message}</p>}

      {steps.length > 0 && (
        <ul className="financing-steps">
          {steps.map((s) => (
            <li key={s.id}>
              <strong>{FINANCING_STATUS_LABEL[s.status]}</strong>
              {s.status === "sent" && s.channel ? ` ${SENT_BY[s.channel] ?? ""}` : ""}
              {s.amount_cents ? ` · ${moneyCents(s.amount_cents)}` : ""} · {fmtDay(s.created_at)}
              {s.by ? ` · ${s.by}` : ""}
              {s.note ? <span className="financing-step-note">{s.note}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
