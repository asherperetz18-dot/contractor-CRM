"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addFinancingLender,
  moveFinancingLender,
  saveFinancingOffer,
  saveFinancingSettings,
  setFinancingLenderActive,
  updateFinancingLender,
  type FinancingSettings,
} from "@/lib/actions/financing";
import { feePercentLabel } from "@/lib/financing";

/**
 * The company's lender and its application link (DECISIONS #161). Empty
 * both and save to switch the offer off.
 */
export function FinancingForm({ initial }: { initial: FinancingSettings }) {
  const router = useRouter();
  const [provider, setProvider] = useState(initial.provider);
  const [url, setUrl] = useState(initial.url);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const changed = provider !== initial.provider || url !== initial.url;
  const on = !!(initial.provider && initial.url);

  function save(next: { provider: string; url: string }) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveFinancingSettings(next);
      if (res.error) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="est-pay">
      <h2 className="est-pay-title">Your lender</h2>
      <p className="est-tax-note">
        If you offer financing through a lender (Wisetack, Hearth, GreenSky or another), look in
        your lender&apos;s dashboard for the link where your customers apply, and paste it here.
        Customers then see{" "}
        <strong>Apply for financing</strong> on their estimates and contracts in their customer
        page, until the job is paid for. The lender takes the application, decides, and sets the
        terms. You&apos;ll hear from the lender, not from the CRM.
      </p>
      <p className="est-tax-note">
        <strong>Check the link the way a customer would before you save it:</strong> open a private
        (incognito) window and paste it there. It should open your lender&apos;s application. If it
        says Access Denied or asks someone to sign in, it&apos;s not the link for customers. A link
        copied from your own browser&apos;s address bar often isn&apos;t.
      </p>
      <p className="est-tax-note">
        The CRM never shows an interest rate or a monthly payment. Those have to come from the
        lender, with its own terms.
      </p>
      {!initial.ready && (
        <p className="error-note">
          Financing needs a database update first: run 0214_customer_financing.sql in Supabase.
        </p>
      )}
      <label className="field" style={{ maxWidth: 360, marginTop: 14 }}>
        <span className="field-label">Lender (customers see this name)</span>
        <input
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setSaved(false);
          }}
          placeholder="e.g. Wisetack"
          maxLength={60}
          disabled={pending || !initial.ready}
        />
      </label>
      <label className="field" style={{ maxWidth: 560, marginTop: 12 }}>
        <span className="field-label">Application link</span>
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setSaved(false);
          }}
          placeholder="https://"
          maxLength={500}
          disabled={pending || !initial.ready}
        />
      </label>
      {/* The link as saved turns customers away (#161 follow-up): say so
          next to it, and what to paste instead. */}
      {initial.problem && url === initial.url && (
        <p className="error-note" style={{ maxWidth: 560 }}>
          Customers aren&apos;t seeing the offer right now. {initial.problem}
        </p>
      )}
      {error && <p className="error-note">{error}</p>}
      {saved && <p className="hint-note">Saved.</p>}
      <div className="est-pay-actions" style={{ marginTop: 14 }}>
        <button
          className="btn-primary"
          onClick={() => save({ provider, url })}
          disabled={pending || !initial.ready || !changed}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {on && (
          <>
            <a className="btn-ghost" href={initial.url} target="_blank" rel="noopener noreferrer">
              Open the link
            </a>
            <button
              className="btn-ghost"
              type="button"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Stop offering financing to customers?")) return;
                setProvider("");
                setUrl("");
                save({ provider: "", url: "" });
              }}
            >
              Turn off
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Whether new estimates offer financing, and the lender's fee (DECISIONS
 * #169). A lender keeps a fee from every loan it funds, so financing can
 * be off by default and turned on customer by customer; the fee shows
 * what it would cost and is recorded as a job cost when a loan pays out.
 */
export function FinancingOfferForm({
  initial,
  feePerLender = false,
}: {
  initial: FinancingSettings["offer"];
  /** Each lender has its own fee (0220, #170): not asked here. */
  feePerLender?: boolean;
}) {
  const router = useRouter();
  const [byDefault, setByDefault] = useState(initial.byDefault);
  const [fee, setFee] = useState(initial.feeBp === null ? "" : String(Number((initial.feeBp / 100).toFixed(2))));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveFinancingOffer(feePerLender ? { offerByDefault: byDefault } : { offerByDefault: byDefault, feePercent: fee });
      if (res.error) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="est-pay">
      <h2 className="est-pay-title">{feePerLender ? "Who sees it" : "Who sees it, and what it costs you"}</h2>
      {!initial.ready && (
        <p className="error-note">This needs a database update first: run 0219_financing_offer.sql in Supabase.</p>
      )}
      <div className="field" style={{ marginTop: 10 }}>
        <span className="field-label">Offer financing on new estimates</span>
        <label className="lender-choice-option">
          <input type="radio" name="offer-default" checked={byDefault} onChange={() => setByDefault(true)} disabled={pending || !initial.ready} />
          <span>On for every customer</span>
        </label>
        <label className="lender-choice-option">
          <input type="radio" name="offer-default" checked={!byDefault} onChange={() => setByDefault(false)} disabled={pending || !initial.ready} />
          <span>Off: I&apos;ll turn it on for the customers I choose</span>
        </label>
        <span className="est-tax-note">Each estimate has its own switch in its Financing section; this is where new ones start.</span>
      </div>
      {!feePerLender && (
      <label className="field" style={{ maxWidth: 360, marginTop: 12 }}>
        <span className="field-label">Your lender&apos;s fee</span>
        <span className="offer-fee-input">
          <input
            inputMode="decimal"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="e.g. 9.9"
            maxLength={6}
            disabled={pending || !initial.ready}
          />
          <span>% of the amount financed</span>
        </span>
        <span className="est-tax-note">
          From your dealer agreement. Used to show what financing costs you and to record the fee when a loan pays out.
          It&apos;s never shown to customers.
        </span>
      </label>
      )}
      {error && <p className="error-note">{error}</p>}
      {saved && <p className="hint-note">Saved.</p>}
      <div className="est-pay-actions" style={{ marginTop: 12 }}>
        <button className="btn-primary" onClick={save} disabled={pending || !initial.ready}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

type LenderItem = FinancingSettings["lenders"]["list"][number];

const feeText = (bp: number | null) => (bp === null ? "" : String(Number((bp / 100).toFixed(2))));

/**
 * The company's lenders, in the order they're tried (DECISIONS #170).
 * Each customer is offered one at a time: the one picked on their
 * estimate, else the first that's on. Off: never offered to a customer.
 */
export function LendersForm({ lenders }: { lenders: LenderItem[] }) {
  const firstOn = lenders.find((l) => l.active && !l.problem)?.id ?? null;
  return (
    <section className="est-pay">
      <h2 className="est-pay-title">Your lenders</h2>
      <p className="est-tax-note">
        Add every lender you offer financing through (Service Finance, Synchrony, Wisetack or another), with the link
        where your customers apply. Customers see one lender at a time: the one picked on their estimate. New estimates
        start on your first lender that&apos;s on, so put the one you&apos;d rather they use first. If a lender says no,
        the estimate&apos;s Financing section offers the next one.
      </p>
      <p className="est-tax-note">
        <strong>Check each link the way a customer would before you save it:</strong> open a private (incognito) window
        and paste it there. It should open your lender&apos;s application. If it says Access Denied or asks someone to
        sign in, it&apos;s not the link for customers. A link copied from your own browser&apos;s address bar often
        isn&apos;t.
      </p>
      <p className="est-tax-note">
        Fees are only seen by your team. The CRM never shows an interest rate or a monthly payment: those have to come
        from the lender, with its own terms.
      </p>
      {lenders.map((l, i) => (
        <LenderRowItem key={l.id ?? i} lender={l} index={i} count={lenders.length} first={l.id === firstOn} />
      ))}
      <AddLender first={!lenders.length} />
    </section>
  );
}

function LenderRowItem({ lender, index, count, first }: { lender: LenderItem; index: number; count: number; first: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = lender.id!;

  function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="lender-row">
      <div className="lender-row-top">
        <div className="lender-row-name">
          {count > 1 && (
            <span className="lender-row-order">
              <button
                type="button"
                aria-label={`Move ${lender.name} up`}
                disabled={pending || index === 0}
                onClick={() => run(() => moveFinancingLender({ id, direction: "up" }))}
              >
                ▲
              </button>
              <button
                type="button"
                aria-label={`Move ${lender.name} down`}
                disabled={pending || index === count - 1}
                onClick={() => run(() => moveFinancingLender({ id, direction: "down" }))}
              >
                ▼
              </button>
            </span>
          )}
          <span>
            {index + 1}. {lender.name}
          </span>
          {first && count > 1 && <span className="est-badge est-badge-financing">Tried first</span>}
          <span className={`est-badge est-badge-${lender.active ? "signed" : "expired"}`}>{lender.active ? "On" : "Off"}</span>
        </div>
        <div className="est-pay-actions lender-row-actions">
          <button type="button" className="btn-ghost small" disabled={pending} onClick={() => setEditing(!editing)}>
            {editing ? "Cancel" : "Edit"}
          </button>
          <a className="btn-ghost small" href={lender.url} target="_blank" rel="noopener noreferrer">
            Open the link
          </a>
          <button
            type="button"
            className="btn-ghost small"
            disabled={pending}
            onClick={() => {
              if (lender.active && !window.confirm(`Stop offering ${lender.name} to customers?`)) return;
              run(() => setFinancingLenderActive({ id, active: !lender.active }));
            }}
          >
            {lender.active ? "Turn off" : "Turn on"}
          </button>
        </div>
      </div>
      <div className="lender-row-meta">
        {lender.feeBp !== null ? `Your fee: ${feePercentLabel(lender.feeBp)}` : "No fee set"} · {lender.url}
      </div>
      {/* A saved link that turns customers away (#161 follow-up). */}
      {lender.problem && (
        <p className="error-note">
          Customers aren&apos;t offered {lender.name} right now. {lender.problem}
        </p>
      )}
      {error && <p className="error-note">{error}</p>}
      {editing && (
        <LenderFields
          initial={{ name: lender.name, url: lender.url, fee: feeText(lender.feeBp) }}
          submitLabel="Save"
          onSave={(v) => updateFinancingLender({ id, name: v.name, url: v.url, feePercent: v.fee })}
          onDone={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function AddLender({ first }: { first: boolean }) {
  const [open, setOpen] = useState(first);
  const [key, setKey] = useState(0);
  if (!open) {
    return (
      <div className="est-pay-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
          + Add a lender
        </button>
      </div>
    );
  }
  return (
    <div className="lender-add">
      <strong>{first ? "Add your lender" : "+ Add a lender"}</strong>
      <LenderFields
        key={key}
        initial={{ name: "", url: "", fee: "" }}
        submitLabel="Add lender"
        onSave={(v) => addFinancingLender({ name: v.name, url: v.url, feePercent: v.fee })}
        onDone={() => {
          setKey(key + 1);
          setOpen(false);
        }}
      />
    </div>
  );
}

function LenderFields({
  initial,
  submitLabel,
  onSave,
  onDone,
}: {
  initial: { name: string; url: string; fee: string };
  submitLabel: string;
  onSave: (v: { name: string; url: string; fee: string }) => Promise<{ error?: string }>;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [url, setUrl] = useState(initial.url);
  const [fee, setFee] = useState(initial.fee);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await onSave({ name, url, fee });
      if (res.error) return setError(res.error);
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="lender-fields">
      <label className="field" style={{ maxWidth: 360, marginTop: 8 }}>
        <span className="field-label">Lender (customers see this name)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Synchrony" maxLength={60} disabled={pending} />
      </label>
      <label className="field" style={{ marginTop: 10 }}>
        <span className="field-label">Application link</span>
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          maxLength={500}
          disabled={pending}
        />
      </label>
      <label className="field" style={{ maxWidth: 360, marginTop: 10 }}>
        <span className="field-label">Your fee</span>
        <span className="offer-fee-input">
          <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="e.g. 6.5" maxLength={6} disabled={pending} />
          <span>% of the amount financed</span>
        </span>
        <span className="est-tax-note">
          From your dealer agreement. Shows what financing costs you, and is recorded as a job cost when a loan pays out.
        </span>
      </label>
      {error && <p className="error-note">{error}</p>}
      <div className="est-pay-actions" style={{ marginTop: 10 }}>
        <button type="button" className="btn-primary" disabled={pending || !name.trim() || !url.trim()} onClick={save}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
