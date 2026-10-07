"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { centsFromInput, moneyCents } from "@/lib/data/types";
import {
  recordFinancingStatus,
  sendFinancingLink,
  setFinancingLender,
  setFinancingOffered,
  tryNextLender,
} from "@/lib/actions/financing";
import { cancelPaymentChange, revertPaymentChange, sendPaymentChange } from "@/lib/actions/payment-change";
import { paymentChangeFigures } from "@/lib/payment-change";
import {
  FINANCING_STATUSES,
  FINANCING_STATUS_LABEL,
  FOLLOW_UP_DAYS,
  currentFinancing,
  feePercentLabel,
  lenderFeeCents,
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
  /** Who the step was with (0218, #168). */
  lender?: string | null;
};

export type FinancingPanelData = {
  /** The lender financing this job (#168): the company's (when it has a
   *  working link) or the customer's own; null for none. */
  provider: string | null;
  /** The customer's own lender: no link to send them. */
  own?: boolean;
  /** Who is financing this job, as chosen on the estimate (0218, #168). */
  choice?: {
    source: "company" | "customer" | "none" | null;
    lender: string | null;
    /** Which of the company's lenders it's with (0220, #170). */
    lenderId?: string | null;
    /** 0218 has run. */
    ready: boolean;
  };
  /** The company's first lender that's on: its name, and whether there is one. */
  company?: { name: string | null; ready: boolean };
  /** The company's lenders that can be picked, in order (#170): the ones
   *  that are on, and the one this estimate is with even if it's off. */
  lenders?: { id: string | null; name: string; feeBp: number | null; usable: boolean }[];
  /** After a no: the next lender to try (#170). */
  next?: { name: string; feeBp: number | null } | null;
  /** Offering financing to this customer, and what it costs (0219, #169). */
  offer?: { ready: boolean; offered: boolean; feeBp: number | null; totalCents: number };
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
  loan: Parameters<typeof paymentChangeFigures>[0] | null;
  /** Switching a signed contract to financing (DECISIONS #166). */
  paymentChange?: {
    /** 0217 has run. */
    ready: boolean;
    /** A signed contract, with a lender link set. */
    canSwitch: boolean;
    /** The change waiting for a signature or in force. */
    change: {
      status: "sent" | "signed";
      lender: string;
      financeCents: number;
      sentAt: string;
      signedName: string | null;
      signedAt: string | null;
    } | null;
  };
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
  // What the lender kept (#169): the company's percent of the payout
  // until someone types what it actually kept.
  const [feeText, setFeeText] = useState<string | null>(null);
  // Follow-ups (#164): a link sent or an application in puts a task on
  // the list of whoever did it.
  const [remind, setRemind] = useState(true);
  const [remindDays, setRemindDays] = useState(3);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const now = currentFinancing(data.steps);
  // Who is financing it (#168). Nothing chosen, no lender of ours and
  // nothing recorded: just the question, so a company that doesn't do
  // financing isn't shown a form on every estimate.
  const notFinancing = data.choice?.source === "none";
  const quiet =
    !data.provider && !data.steps.length && !data.paymentChange?.change && !data.choice?.source && !notFinancing;
  const withAmount = status === "approved" || status === "funded";
  const payout = status === "funded" && data.canRecordPayment && !!data.loan && asPayment;
  const amountCents = amount.trim() ? centsFromInput(amount) : 0;
  const split = data.loan ? splitFundedLoan({ ...data.loan, amountCents }) : null;
  const suggestedFee = lenderFeeCents(amountCents, data.offer?.feeBp) ?? 0;
  const feeCents = feeText === null ? suggestedFee : feeText.trim() ? centsFromInput(feeText) : 0;
  // Offered to this customer (#169): before 0219, always.
  const offered = data.offer?.ready ? data.offer.offered : true;
  const remindInDays = data.followUpsReady && remind ? remindDays : null;
  // After a no, the next lender is offered (#170) in place of resending
  // the link of the one that said no.
  const tryNext =
    data.canWork &&
    data.ready &&
    !!data.next &&
    !!data.provider &&
    !data.own &&
    !notFinancing &&
    offered &&
    now?.status === "declined" &&
    !data.paymentChange?.change;
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
        payment: payout ? { receivedOn: paidOn, reference: loanRef, feeCents: data.own ? 0 : feeCents } : null,
        remindInDays: remindsFor(status) ? remindInDays : null,
      });
      if (res.error) return setError(res.error);
      setMessage(
        `Saved.${res.paidCents ? ` ${moneyCents(res.paidCents)} recorded as payments on the contract.` : ""}${res.feeCents ? ` ${moneyCents(res.feeCents)} lender's fee saved as a job cost.` : ""}${res.movedTo ? ` The lead moved to ${res.movedTo}.` : ""}${followUpLine(res.followUpOn)}${res.warning ? ` ${res.warning}` : ""}`
      );
      setLoanRef("");
      setFeeText(null);
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
      {data.canWork && data.choice?.ready && (
        <LenderChoice estimateId={estimateId} data={data} compact={quiet} />
      )}
      {!quiet && (
        <p className="est-tax-note">
          {notFinancing
            ? "Not financing. If the customer finances this job after all, pick who above."
            : data.provider && data.own
              ? `The customer is financing through ${data.provider}, their own lender. Record what they tell you here; a customer who applies or is approved moves to Pending Finance.`
              : data.provider && !offered
                ? `Financing isn't offered to this customer (see the switch below). If they ask about it, record what ${data.provider} tells you here; a customer who applies or is approved moves to Pending Finance.`
                : data.provider
                ? `The customer can apply with ${data.provider} from their customer page, or you can send them the link. Record what ${data.provider} tells you here; a customer who applies or is approved moves to Pending Finance.`
                : `There's no lender link set up (Settings › Customer Financing), so this only keeps track of where the customer's financing stands.${data.choice?.ready ? " Or pick the customer's own lender above." : ""}`}
        </p>
      )}
      {!data.ready && (
        <p className="error-note">
          Financing tracking needs a database update first: run 0215_estimate_financing.sql in Supabase.
        </p>
      )}

      {data.canWork && data.ready && data.followUpsReady && !quiet && !notFinancing && (
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

      {data.canWork && data.ready && data.offer?.ready && data.provider && !data.own && !notFinancing && !quiet && (
        <OfferSwitch estimateId={estimateId} provider={data.provider} offer={data.offer} />
      )}

      {tryNext && now && (
        <TryNextLender estimateId={estimateId} data={data} declinedOn={now.created_at} remindInDays={remindInDays} />
      )}

      {data.canWork && data.ready && data.provider && !data.own && !notFinancing && offered && !tryNext && (
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

      {data.canWork && data.ready && !quiet && !notFinancing && (
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
                  {!data.own && (
                    <div className="financing-record">
                      <label className="field">
                        <span className="field-label">Lender kept a fee</span>
                        <input
                          className="est-item-price"
                          inputMode="decimal"
                          value={feeText ?? (suggestedFee ? (suggestedFee / 100).toFixed(2) : "")}
                          onChange={(e) => setFeeText(e.target.value)}
                          placeholder="0.00"
                          disabled={pending}
                        />
                      </label>
                      <p className="est-tax-note financing-fee-note">
                        {data.offer?.feeBp !== null && data.offer?.feeBp !== undefined && feeText === null
                          ? `${feePercentLabel(data.offer.feeBp)} of the payout, from Settings; change it to what the lender actually kept. `
                          : ""}
                        Saved as a job cost on this job, so its profit is right.
                        {amountCents > 0 && feeCents > 0
                          ? ` The loan brings in ${moneyCents(Math.max(0, amountCents - feeCents))}.`
                          : ""}
                      </p>
                    </div>
                  )}
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
                    Paid out in draws? Record each draw as Funded
                    with its amount: it goes on the next payment still owed, and the rest stays open for the next draw.
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

      {data.canWork && data.paymentChange?.ready && (
        <SwitchToFinancing estimateId={estimateId} data={data} remindInDays={remindInDays} />
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
              {s.lender ? <span className="financing-step-note">{s.lender}</span> : null}
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

const PAYMENT_CHANGE_BADGE: Record<"paid" | "billed" | "open", { label: string; cls: string }> = {
  paid: { label: "Paid · stays", cls: "signed" },
  billed: { label: "Reminders pause", cls: "financing" },
  open: { label: "Not billed", cls: "financing" },
};

/**
 * The customer signed to pay directly and would rather finance the rest
 * (DECISIONS #166). Not switched: what would be financed, line by line,
 * and a payment change to text or email them to sign. Sent: waiting on
 * their signature. Signed: paying with financing, and the way back.
 */
function SwitchToFinancing({
  estimateId,
  data,
  remindInDays,
}: {
  estimateId: string;
  data: FinancingPanelData;
  remindInDays: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [withApply, setWithApply] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const pc = data.paymentChange!;
  const change = pc.change;
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  function run(action: () => Promise<{ error?: string; sentBy?: string; warning?: string }>, done: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) return setError(res.error);
      setMessage(res.warning ?? done);
      setOpen(false);
      router.refresh();
    });
  }

  function send(channel: "text" | "email") {
    if (!window.confirm(`${channel === "text" ? "Text" : "Email"} the customer the payment change to sign?`)) return;
    run(
      () =>
        sendPaymentChange({
          estimateId,
          channel,
          withApplyLink: !change && withApply && !data.own && (data.offer?.ready ? data.offer.offered : true),
          remindInDays,
        }),
      `Sent by ${channel}. It's on their customer page to sign.`
    );
  }

  const sendButtons = (again: boolean) => (
    <div className="est-pay-actions">
      <button
        type="button"
        className={again ? "btn-ghost" : "btn-primary"}
        disabled={pending || !data.hasPhone}
        title={data.hasPhone ? undefined : "This customer has no phone number on file"}
        onClick={() => send("text")}
      >
        {again ? "Text it again" : "Text it to sign"}
      </button>
      <button
        type="button"
        className="btn-ghost"
        disabled={pending || !data.hasEmail}
        title={data.hasEmail ? undefined : "This customer has no email address on file"}
        onClick={() => send("email")}
      >
        {again ? "Email it again" : "Email it to sign"}
      </button>
    </div>
  );

  let body: React.ReactNode = null;
  if (change?.status === "signed") {
    body = (
      <div className="payment-change">
        <h3>
          Paying with financing <span className="est-badge est-badge-financing">{change.lender}</span>
        </h3>
        <p className="est-tax-note">
          {change.signedName && change.signedAt
            ? `${change.signedName} signed the payment change on ${day(change.signedAt)}: `
            : "The payment change is signed: "}
          {moneyCents(change.financeCents)} to be paid through {change.lender}. No bills or reminders go to the
          customer for it.
        </p>
        <div className="est-pay-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={pending}
            onClick={() => {
              if (
                !window.confirm(
                  "Put this contract back on its original payment schedule? Billing and reminders pick up where they were."
                )
              )
                return;
              run(() => revertPaymentChange(estimateId), "Back on the original schedule.");
            }}
          >
            Back to the original schedule
          </button>
        </div>
        <p className="est-tax-note">For a decline, or if the customer changes their mind.</p>
      </div>
    );
  } else if (change?.status === "sent") {
    body = (
      <div className="payment-change">
        <h3>Payment change sent {day(change.sentAt)}</h3>
        <p className="est-tax-note">
          Waiting for the customer to sign it on their customer page: {moneyCents(change.financeCents)} to be paid
          through {change.lender}. Until then, the original schedule stands.
        </p>
        {sendButtons(true)}
        <div className="est-pay-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Take back the payment change? The customer won't be able to sign it.")) return;
              run(() => cancelPaymentChange(estimateId), "Taken back.");
            }}
          >
            Take it back
          </button>
        </div>
      </div>
    );
  } else if (pc.canSwitch && data.loan && data.provider) {
    const f = paymentChangeFigures(data.loan);
    if (f.financeCents > 0) {
      body = !open ? (
        <div className="est-pay-actions">
          <button type="button" className="btn-ghost" onClick={() => setOpen(true)} disabled={pending}>
            Switch to financing…
          </button>
        </div>
      ) : (
        <div className="payment-change">
          <h3>Switch to financing with {data.provider}</h3>
          <p className="est-tax-note">
            This contract was signed to be paid directly. If the customer would rather finance what&apos;s left,
            they sign a one-page payment change; the price doesn&apos;t change.
          </p>
          <div className="est-tax-note">Amount to finance (what&apos;s left to pay)</div>
          <div className="payment-change-amount">{moneyCents(f.financeCents)}</div>
          <div className="est-tax-note">
            {moneyCents(f.totalCents)} total · {moneyCents(f.paidCents)} already paid
            {f.creditCents > 0 ? ` · ${moneyCents(f.creditCents)} credited` : ""}
          </div>
          <table className="payment-change-lines">
            <tbody>
              {f.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.label}</td>
                  <td className="mono">{moneyCents(r.state === "paid" ? r.cents : r.owedCents)}</td>
                  <td>
                    <span className={`est-badge est-badge-${PAYMENT_CHANGE_BADGE[r.state].cls}`}>
                      {PAYMENT_CHANGE_BADGE[r.state].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Only the company's lender has a link to apply with (#168). */}
          {!data.own && (data.offer?.ready ? data.offer.offered : true) && (
            <label className="est-record-check">
              <input type="checkbox" checked={withApply} onChange={(e) => setWithApply(e.target.checked)} disabled={pending} />
              <span>Also send the link to apply with {data.provider}</span>
            </label>
          )}
          <p className="est-tax-note">
            {data.own
              ? "Bills and reminders pause once the customer signs. If their loan doesn't come through, one click puts the original schedule back."
              : `If ${data.provider} says no, one click puts the original schedule back.`}
          </p>
          {sendButtons(false)}
          <div className="est-pay-actions">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </button>
          </div>
        </div>
      );
    }
  }

  if (!body && !error && !message) return null;
  return (
    <>
      {body}
      {error && <p className="error-note">{error}</p>}
      {message && <p className="hint-note">{message}</p>}
    </>
  );
}

/**
 * Who is financing this job (DECISIONS #168): the company's lender (with
 * a link the customer applies with), the customer's own bank or credit
 * union (named here), or nobody. Saved on the estimate; the steps, the
 * payment change and the payout use it.
 */
function LenderChoice({ estimateId, data, compact }: { estimateId: string; data: FinancingPanelData; compact: boolean }) {
  const router = useRouter();
  // A company lender is picked as "company:<its id>" (#170); before 0220
  // its one lender has no id.
  const lenders = data.lenders?.length
    ? data.lenders
    : data.company?.ready
      ? [{ id: null, name: data.company.name || "Your lender", feeBp: null, usable: true }]
      : [];
  const firstId = lenders.find((l) => l.usable)?.id ?? null;
  const companyKey = (id: string | null) => `company:${id ?? ""}`;
  const savedSource = data.choice?.source ?? (data.company?.ready ? "company" : null);
  const saved = savedSource === "company" ? companyKey(data.choice?.lenderId ?? firstId) : savedSource;
  const [source, setSource] = useState<string | null>(saved);
  const [name, setName] = useState(data.choice?.lender ?? "");
  const [open, setOpen] = useState(!compact);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(next: string, lender?: string) {
    setError(null);
    const [kind, id] = next.split(":");
    startTransition(async () => {
      const res = await setFinancingLender({ estimateId, source: kind, lender, lenderId: kind === "company" ? id || null : null });
      if (res.error) {
        setError(res.error);
        setSource(saved);
        return;
      }
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="est-pay-actions">
        <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
          Is the customer financing this job?
        </button>
      </div>
    );
  }

  return (
    <div className="lender-choice">
      <div className="lender-choice-title">Who is financing this job?</div>
      {lenders.map((l) => (
        <label key={l.id ?? "lender"} className="lender-choice-option">
          <input
            type="radio"
            name={`lender-${estimateId}`}
            checked={source === companyKey(l.id)}
            disabled={pending || !l.usable}
            onChange={() => {
              setSource(companyKey(l.id));
              save(companyKey(l.id));
            }}
          />
          <span>
            {l.name}{" "}
            <span className="lender-choice-hint">{lenderHint(l, l.id === firstId, lenders.length)}</span>
          </span>
        </label>
      ))}
      {!lenders.length && (
        <label className="lender-choice-option">
          <input type="radio" name={`lender-${estimateId}`} checked={false} disabled />
          <span>
            Your lender <span className="lender-choice-hint">(add one under Settings › Customer Financing)</span>
          </span>
        </label>
      )}
      <label className="lender-choice-option">
        <input
          type="radio"
          name={`lender-${estimateId}`}
          checked={source === "customer"}
          disabled={pending}
          onChange={() => setSource("customer")}
        />
        <span>The customer&apos;s own lender</span>
      </label>
      {source === "customer" && (
        <div className="lender-choice-name">
          <input
            className="est-item-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. their bank or credit union"
            maxLength={60}
            disabled={pending}
            aria-label="The customer's lender"
          />
          {(saved !== "customer" || name.trim() !== (data.choice?.lender ?? "")) && (
            <button type="button" className="btn-primary" disabled={pending || !name.trim()} onClick={() => save("customer", name)}>
              {pending ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      )}
      <label className="lender-choice-option">
        <input
          type="radio"
          name={`lender-${estimateId}`}
          checked={source === "none"}
          disabled={pending}
          onChange={() => {
            setSource("none");
            save("none");
          }}
        />
        <span>Not financing</span>
      </label>
      {error && <p className="error-note">{error}</p>}
    </div>
  );
}

/** Beside a lender's name: which one is tried first, its fee, or that it's off. */
function lenderHint(l: { usable: boolean; feeBp: number | null }, first: boolean, count: number): string {
  if (!l.usable) return "(turned off, or its link doesn't work, under Settings › Customer Financing)";
  const fee = l.feeBp !== null ? `fee ${feePercentLabel(l.feeBp)}` : null;
  if (count === 1) return `(your lender: you can text or email the link to apply${fee ? `, ${fee}` : ""})`;
  const parts = [first ? "your first lender" : null, fee].filter(Boolean);
  return parts.length ? `(${parts.join(", ")})` : "";
}

/**
 * After a lender says no (DECISIONS #170): move this estimate to the next
 * lender and send the customer its link, in one click. By text, or by
 * email instead.
 */
function TryNextLender({
  estimateId,
  data,
  declinedOn,
  remindInDays,
}: {
  estimateId: string;
  data: FinancingPanelData;
  declinedOn: string;
  remindInDays: number | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const next = data.next!;
  const total = data.offer?.totalCents ?? 0;
  const fee = lenderFeeCents(total, next.feeBp);

  function go(channel: "text" | "email") {
    if (!window.confirm(`Move this estimate to ${next.name} and ${channel === "text" ? "text" : "email"} the customer ${next.name}'s link?`)) {
      return;
    }
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await tryNextLender({ estimateId, channel, remindInDays });
      if (res.sentBy) setMessage(`Now with ${res.lender}. Sent by ${res.sentBy}.${followUpLine(res.followUpOn)}`);
      if (res.error) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="financing-next">
      <strong>
        {data.provider} declined on {fmtDay(declinedOn)}.
      </strong>
      <p className="est-tax-note">
        Try your next lender: this estimate moves to {next.name}, and the customer gets {next.name}&apos;s link
        {data.hasPhone ? " by text" : " by email"}.
      </p>
      {fee !== null && total > 0 && next.feeBp !== null && (
        <p className="offer-cost">
          With {next.name}, if they finance the full {moneyCents(total)}, {next.name} keeps about {moneyCents(fee)} (
          {feePercentLabel(next.feeBp)}). You&apos;d get {moneyCents(total - fee)}.
        </p>
      )}
      <div className="est-pay-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={pending || (!data.hasPhone && !data.hasEmail)}
          onClick={() => go(data.hasPhone ? "text" : "email")}
        >
          {pending ? "Sending…" : `Try ${next.name} next`}
        </button>
        {data.hasPhone && data.hasEmail && (
          <button type="button" className="btn-ghost" disabled={pending} onClick={() => go("email")}>
            Email it instead
          </button>
        )}
      </div>
      {error && <p className="error-note">{error}</p>}
      {message && <p className="hint-note">{message}</p>}
    </div>
  );
}

/**
 * Offer financing to this customer, or not (DECISIONS #169): the lender
 * keeps a fee from every loan, so it's offered where it's worth it. Off:
 * no Apply card on their page and no link to send. With the fee set, what
 * it would cost on the whole estimate.
 */
function OfferSwitch({
  estimateId,
  provider,
  offer,
}: {
  estimateId: string;
  provider: string;
  offer: NonNullable<FinancingPanelData["offer"]>;
}) {
  const router = useRouter();
  const [on, setOn] = useState(offer.offered);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fee = lenderFeeCents(offer.totalCents, offer.feeBp);

  function flip() {
    const next = !on;
    setOn(next);
    setError(null);
    startTransition(async () => {
      const res = await setFinancingOffered({ estimateId, offered: next });
      if (res.error) {
        setOn(!next);
        return setError(res.error);
      }
      router.refresh();
    });
  }

  return (
    <>
      <div className="offer-switch">
        <div>
          <strong>Offer financing to this customer</strong>
          <div className="est-tax-note">
            {on
              ? `On: they see "Apply for financing" on their page.`
              : `Off: they don't see "Apply for financing", and there are no link buttons.`}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Offer financing to this customer"
          className={"offer-toggle" + (on ? " is-on" : "")}
          onClick={flip}
          disabled={pending}
        />
      </div>
      {fee !== null && offer.totalCents > 0 && offer.feeBp !== null && (
        <p className="offer-cost">
          If they finance the full {moneyCents(offer.totalCents)}, {provider} keeps about {moneyCents(fee)} (
          {feePercentLabel(offer.feeBp)}). You&apos;d get {moneyCents(offer.totalCents - fee)}.
        </p>
      )}
      {error && <p className="error-note">{error}</p>}
    </>
  );
}
