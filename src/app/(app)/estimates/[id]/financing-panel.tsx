"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { centsFromInput, moneyCents } from "@/lib/data/types";
import { recordFinancingStatus, sendFinancingLink } from "@/lib/actions/financing";
import {
  FINANCING_STATUSES,
  FINANCING_STATUS_LABEL,
  FOLLOW_UP_DAYS,
  currentFinancing,
  remindsFor,
  splitFundedLoan,
  type FinancingEvent,
  type FinancingStatus,
} from "@/lib/financing";

export type FinancingStep = FinancingEvent & {
  id: string;
  channel: string | null;
  by: string | null;
  /** The follow-up task the step put on someone's list (#164). */
  followUp?: { due: string; done: boolean } | null;
};

export type FinancingPanelData = {
  /** The company's lender, when it has a link set (0214). */
  provider: string | null;
  steps: FinancingStep[];
  /** 0215 has run. */
  ready: boolean;
  /** 0216 has run: a step can put a follow-up task on the list (#164). */
  followUpsReady: boolean;
  /** Works estimates or records payments. */
  canWork: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  /** Records payments, on a signed contract: Funded can also record the
   *  payout (DECISIONS #163). */
  canRecordPayment: boolean;
  /** What's on the contract, to show where a payout would go. */
  loan: Omit<Parameters<typeof splitFundedLoan>[0], "amountCents"> | null;
};

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** A plain YYYY-MM-DD, as the day it is wherever it's read. */
const fmtDue = (isoDay: string) =>
  new Date(`${isoDay}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

const followUpLine = (due?: string) => (due ? ` A follow-up task is on your Tasks for ${fmtDue(due)}.` : "");

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
  // Funded: the payout recorded as payments on the contract (#163).
  const [asPayment, setAsPayment] = useState(true);
  const [paidOn, setPaidOn] = useState(localToday);
  const [loanRef, setLoanRef] = useState("");
  // Follow-ups (#164): a link sent or an application in puts a task on
  // the list of whoever did it.
  const [remind, setRemind] = useState(true);
  const [remindDays, setRemindDays] = useState(3);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const now = currentFinancing(data.steps);
  const withAmount = status === "approved" || status === "funded";
  const payout = status === "funded" && data.canRecordPayment && !!data.loan && asPayment;
  const amountCents = amount.trim() ? centsFromInput(amount) : 0;
  const split = data.loan ? splitFundedLoan({ ...data.loan, amountCents }) : null;
  const remindInDays = data.followUpsReady && remind ? remindDays : null;
  const steps = [...data.steps].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  function send(channel: "text" | "email") {
    if (!window.confirm(`${channel === "text" ? "Text" : "Email"} the customer the link to apply with ${data.provider}?`)) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await sendFinancingLink({ estimateId, channel, remindInDays });
      if (res.sentBy) setMessage(`Sent by ${res.sentBy}.${followUpLine(res.followUpOn)}`);
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
        payment: payout ? { receivedOn: paidOn, reference: loanRef } : null,
        remindInDays: remindsFor(status) ? remindInDays : null,
      });
      if (res.error) return setError(res.error);
      setMessage(
        `Saved.${res.paidCents ? ` ${moneyCents(res.paidCents)} recorded as payments on the contract.` : ""}${res.movedTo ? ` The lead moved to ${res.movedTo}.` : ""}${followUpLine(res.followUpOn)}`
      );
      setLoanRef("");
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

      {data.canWork && data.ready && data.followUpsReady && (
        <div className="financing-remind">
          <label className="est-record-check">
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} disabled={pending} />
            <span>Remind me to follow up in</span>
          </label>
          <select
            aria-label="Days until the follow-up"
            value={remindDays}
            onChange={(e) => setRemindDays(Number(e.target.value))}
            disabled={pending || !remind}
          >
            {FOLLOW_UP_DAYS.map((d) => (
              <option key={d} value={d}>
                {d === 1 ? "1 day" : `${d} days`}
              </option>
            ))}
          </select>
          <span className="financing-remind-when">when the link goes out or they apply</span>
        </div>
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
              <span className="field-label">{payout ? "Amount the loan covers" : "Amount (optional)"}</span>
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
          {status === "funded" && data.canRecordPayment && data.loan && (
            <div className="financing-payout">
              <label className="est-record-check">
                <input
                  type="checkbox"
                  checked={asPayment}
                  onChange={(e) => setAsPayment(e.target.checked)}
                  disabled={pending}
                />
                <span>Also record it as a payment{data.provider ? ` from ${data.provider}` : ""} on this contract</span>
              </label>
              {asPayment && (
                <>
                  <div className="financing-record">
                    <label className="field">
                      <span className="field-label">Paid out on</span>
                      <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} disabled={pending} />
                    </label>
                    <label className="field">
                      <span className="field-label">Loan or application # (optional)</span>
                      <input
                        className="est-item-name"
                        value={loanRef}
                        onChange={(e) => setLoanRef(e.target.value)}
                        maxLength={80}
                        disabled={pending}
                      />
                    </label>
                  </div>
                  <p className="est-tax-note">
                    {!split || !amountCents
                      ? `Still to pay on this contract: ${moneyCents(split?.openCents ?? 0)}. Enter the full amount the loan covers.`
                      : split.overCents > 0
                        ? `That's more than the ${moneyCents(split.openCents)} still to pay on this contract.`
                        : `It pays ${split.parts.map((p) => `${p.label} ${moneyCents(p.cents)}`).join(", ")}. ${
                            split.leftCents > 0 ? `${moneyCents(split.leftCents)} will still be owed.` : "Nothing will be left to pay."
                          }`}{" "}
                    If the lender keeps a fee, add it as a job cost.
                  </p>
                </>
              )}
            </div>
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
              {s.followUp ? (
                <span className="financing-step-note">
                  {s.followUp.done ? "Follow-up task done." : `Follow-up task due ${fmtDue(s.followUp.due)}.`}
                </span>
              ) : null}
              {s.note ? <span className="financing-step-note">{s.note}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
