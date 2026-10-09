"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  disconnectQuickBooks,
  refreshQuickBooksAccounts,
  saveQuickBooksBillSending,
  saveQuickBooksInvoiceSending,
  saveQuickBooksMatches,
  sendBillsToQuickBooksNow,
  sendInvoicesToQuickBooksNow,
  type QuickBooksSettings,
  type SendNowResult,
} from "@/lib/actions/quickbooks";

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** A YYYY-MM-DD day as "Oct 8, 2026", read as that calendar day wherever the browser is. */
const fmtDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** "3 minutes ago", for when the job last looked. */
function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return fmtDay(iso);
}

const KIND: Record<string, string> = { bank: "Bank account", credit_card: "Card", cash: "Cash" };

/**
 * Settings › QuickBooks: connect the company's QuickBooks Online and match
 * its accounts (DECISIONS #172), then send its bills and bill payments
 * (#173), with their receipts (#174), and its invoices and customer
 * payments (#184).
 */
export function QuickBooksView({
  settings,
  justConnected,
  connectError,
}: {
  settings: QuickBooksSettings;
  justConnected: boolean;
  connectError: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const c = settings.connection;
  const connected = !!c?.connected;

  function run(action: () => Promise<{ error?: string; count?: number }>, done: (r: { count?: number }) => string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) return setError(res.error);
      setMessage(done(res));
      router.refresh();
    });
  }

  return (
    <>
      {justConnected && !connectError && (
        <p className="hint-note" style={{ color: "var(--success)" }}>
          ✓ Connected to QuickBooks. Check the matches below, then save them.
        </p>
      )}
      {connectError && <p className="error-note">{connectError}</p>}
      {!settings.ready && (
        <p className="error-note">QuickBooks needs a database update first: run 0221_quickbooks_connection.sql in Supabase.</p>
      )}

      <section className="est-pay">
        <h2 className="est-pay-title">
          QuickBooks
          {connected && <span className="est-badge est-badge-signed">Connected</span>}
          {connected && c?.environment === "sandbox" && <span className="est-badge est-badge-financing">Practice company</span>}
        </h2>

        {!settings.configured ? (
          <p className="est-tax-note">
            {settings.encryption
              ? "QuickBooks isn't set up on the CRM yet. AI Build Pros adds its QuickBooks app once; then every company can connect its own QuickBooks here."
              : "QuickBooks isn't set up on the CRM yet: the CRM's encryption key has to be in place before it can keep a QuickBooks login."}
          </p>
        ) : connected ? (
          <>
            <div className="qb-status">
              Connected to <strong>{c?.companyName || "your QuickBooks company"}</strong> (QuickBooks Online)
              <div className="est-tax-note">
                {[c?.connectedByName ? `by ${c.connectedByName}` : null, c?.connectedAt ? fmtDay(c.connectedAt) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            {c?.lastError && <p className="error-note">{c.lastError}</p>}
            <div className="est-pay-actions">
              {c?.lastError && /connect again/i.test(c.lastError) && (
                <a className="btn-primary" href="/api/oauth/quickbooks/authorize">
                  Connect again
                </a>
              )}
              <button
                type="button"
                className="btn-ghost"
                disabled={pending}
                onClick={() => run(refreshQuickBooksAccounts, (r) => `Read ${r.count ?? 0} accounts from QuickBooks.`)}
              >
                Refresh accounts
              </button>
              <button
                type="button"
                className="btn-danger-ghost"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm("Disconnect QuickBooks? Nothing in QuickBooks changes; your matches are kept for when you connect again.")) {
                    return;
                  }
                  run(disconnectQuickBooks, () => "Disconnected. Nothing in QuickBooks changed.");
                }}
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="est-tax-note">
              Send your bills, invoices and payments from the CRM to QuickBooks Online, so your bookkeeping isn&apos;t typed
              twice. Connect with the QuickBooks login of whoever owns your books.
            </p>
            <div className="est-pay-actions">
              <a className={`qb-connect${settings.ready ? "" : " is-disabled"}`} href={settings.ready ? "/api/oauth/quickbooks/authorize" : undefined}>
                Connect to QuickBooks
              </a>
            </div>
            <p className="est-tax-note">
              QuickBooks Online only. You&apos;ll sign in on Intuit&apos;s page and pick your company; the CRM never sees your
              QuickBooks password.
              {settings.environment === "sandbox" ? " For now this connects Intuit's practice companies, for trying it out." : ""}
            </p>
          </>
        )}
        {error && <p className="error-note">{error}</p>}
        {message && <p className="hint-note">{message}</p>}

        <h3 className="qb-subhead">How it works</h3>
        <ul className="qb-rules">
          <li>
            One way: from the CRM to QuickBooks. The CRM only ever changes what it sent itself, never anything you
            entered in QuickBooks.
          </li>
          <li>
            Each bill and payment goes once and is marked <strong>In QuickBooks</strong>, so nothing is entered twice. A
            change to a bill you pay in the CRM (amount, date, vendor) is sent too.
          </li>
          <li>A bill&apos;s receipt (the photo or PDF attached in the CRM) is attached to it in QuickBooks too.</li>
          <li>
            Each bill to a customer goes as an invoice, each payment as a payment on it, and each signed contract as a job
            under its customer. Customers get only what the CRM sends them: nothing is emailed from QuickBooks.
          </li>
          <li>
            An invoice already in QuickBooks gets its new dates; any other change to it waits, saying so, for you to make
            there by hand.
          </li>
          <li>
            A bill voided in the CRM is deleted in QuickBooks (QuickBooks can&apos;t void a bill); a payment deleted in the
            CRM is voided there.
          </li>
          <li>
            Anything that can&apos;t go says why, on its row in Bills to Pay or the Invoices page (or under Needs a look
            below, for a stage that has no row there), and goes as soon as it&apos;s fixed. Anything it says to enter in
            QuickBooks by hand stays that way, so it&apos;s never entered twice.
          </li>
          <li>Disconnect any time. What&apos;s already in QuickBooks stays there.</li>
        </ul>
        <h3 className="qb-subhead">The plan</h3>
        <ol className="qb-plan">
          <li>
            Connect, and match your accounts <span className="est-badge est-badge-signed">Live</span>
          </li>
          <li>
            Bills, bill payments and their receipts go to QuickBooks <span className="est-badge est-badge-signed">Live</span>
          </li>
          <li className="is-now">
            <strong>Customers, invoices and customer payments</strong> <span className="est-badge est-badge-signed">Live</span>
          </li>
          <li>Job costs, including lender fees</li>
        </ol>
      </section>

      {connected && <BillSending settings={settings} />}
      {connected && <InvoiceSending settings={settings} />}
      {connected && <MatchForm settings={settings} />}
    </>
  );
}

/** What Send now did, in a sentence. */
function sentMessage(res: SendNowResult): { message: string | null; error: string | null } {
  const parts = [
    res.sent ? `${res.sent} sent` : null,
    res.changed ? `${res.changed} updated` : null,
    res.removed ? `${res.removed} removed` : null,
    res.waiting ? `${res.waiting} waiting` : null,
    res.failed ? `${res.failed} didn't go` : null,
  ].filter(Boolean);
  if (res.error && !parts.length) return { message: null, error: res.error };
  return {
    message:
      (parts.length ? `Done: ${parts.join(", ")}.` : "Nothing new to send.") +
      (res.waiting || res.failed ? " See Needs a look." : "") +
      (res.more ? " The rest go in the next few minutes." : ""),
    error: res.error ?? null,
  };
}

/** Send bills to QuickBooks: the switch, the start date, and how it's going. */
function BillSending({ settings }: { settings: QuickBooksSettings }) {
  const router = useRouter();
  const b = settings.bills;
  const [on, setOn] = useState(b.on);
  const [from, setFrom] = useState(b.from ?? b.today);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = on !== b.on || (on && from !== b.from);

  function save() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await saveQuickBooksBillSending({ on, from: on ? from : null });
      if (res.error) return setError(res.error);
      setMessage(
        on
          ? `Saved. Bills dated from ${fmtDate(from)} go to QuickBooks within a few minutes.`
          : "Saved. Nothing more goes to QuickBooks; what's there stays."
      );
      router.refresh();
    });
  }

  function sendNow() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const out = sentMessage(await sendBillsToQuickBooksNow());
      setMessage(out.message);
      setError(out.error);
      router.refresh();
    });
  }

  return (
    <section className="est-pay">
      <h2 className="est-pay-title">Send bills to QuickBooks</h2>
      {!b.ready && <p className="error-note">Sending bills needs a database update first: run 0222_quickbooks_bills.sql in Supabase.</p>}
      {b.ready && b.receiptsReady === false && (
        <p className="error-note">Receipts need a database update first: run 0223_quickbooks_receipts.sql in Supabase. Bills and payments go meanwhile.</p>
      )}
      <div className="qb-switch-row">
        <div>
          <strong>Bills and bill payments</strong>
          <div className="est-tax-note">On: each one goes to QuickBooks a few minutes after it&apos;s saved.</div>
        </div>
        <button
          type="button"
          className="ur-toggle-btn"
          aria-pressed={on}
          aria-label="Send bills and bill payments to QuickBooks"
          disabled={pending || !b.ready}
          onClick={() => {
            setOn(!on);
            setMessage(null);
          }}
        >
          <span className={"toggle-track" + (on ? " toggle-on" : "")}>
            <span className="toggle-thumb" />
          </span>
        </button>
      </div>
      {on && (
        <>
          <label className="field qb-from">
            <span className="field-label">Start with bills dated from</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={pending} />
          </label>
          <p className="est-tax-note">
            Bills dated before this stay out of QuickBooks, so the ones already entered there by hand aren&apos;t doubled. You
            can move it back to send older ones.
          </p>
        </>
      )}
      {settings.connection?.environment === "sandbox" && (
        <p className="est-tax-note">This sends to your practice company, so you can see it work before your real books.</p>
      )}
      {error && <p className="error-note">{error}</p>}
      {message && <p className="hint-note">{message}</p>}
      {changed && (
        <div className="est-pay-actions">
          <button type="button" className="btn-primary" onClick={save} disabled={pending || !b.ready || (on && !from)}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {b.on && (
        <>
          <div className="qb-counts">
            <div className="qb-count">
              <b>{b.counts.sent}</b>
              <span>In QuickBooks</span>
            </div>
            <div className="qb-count">
              <b>{b.counts.waiting}</b>
              <span>Waiting</span>
            </div>
            <div className={"qb-count" + (b.counts.failed ? " is-failed" : "")}>
              <b>{b.counts.failed}</b>
              <span>Didn&apos;t go</span>
            </div>
          </div>
          {b.attention.length > 0 && (
            <>
              <h3 className="qb-subhead">Needs a look</h3>
              <ul className="qb-attention">
                {b.attention.map((a, i) => (
                  <li key={i} className={a.status === "waiting" ? undefined : "is-failed"}>
                    <strong>
                      {a.vendor}
                      {a.amountCents !== null ? ` · ${money(a.amountCents)}` : ""} {a.kind}
                    </strong>
                    {a.deleted ? " (deleted in the CRM)" : a.day ? ` on ${fmtDate(a.day)}` : ""}
                    <div className="est-tax-note">{a.reason}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="est-pay-actions qb-send-row">
            <button type="button" className="btn-ghost" onClick={sendNow} disabled={pending || changed}>
              {pending ? "Sending…" : "Send now"}
            </button>
            <span className="est-tax-note" suppressHydrationWarning>
              {b.checkedAt ? `Last checked ${ago(b.checkedAt)}` : "Not checked yet: the first run is within five minutes."}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

/** Which QuickBooks account is which: where money is paid from, and where
 *  each cost category lands. */
function MatchForm({ settings }: { settings: QuickBooksSettings }) {
  const router = useRouter();
  const [paid, setPaid] = useState(() => Object.fromEntries(settings.paidFrom.map((a) => [a.id, a.qbAccountId ?? ""])));
  const [cats, setCats] = useState(() => Object.fromEntries(settings.categories.map((c) => [c.key, c.qbAccountId ?? ""])));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const noAccounts = !settings.choices.paidFrom.length && !settings.choices.expense.length;

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveQuickBooksMatches({
        paidFrom: settings.paidFrom.map((a) => ({ id: a.id, qbAccountId: paid[a.id] || null })),
        categories: settings.categories.map((c) => ({ category: c.category, qbAccountId: cats[c.key] || null })),
      });
      if (res.error) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  const select = (value: string, onChange: (v: string) => void, options: { id: string; name: string; type: string }[], label: string) => (
    <select className="qb-select" value={value} onChange={(e) => onChange(e.target.value)} disabled={pending} aria-label={label}>
      <option value="">Pick an account</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name} ({o.type})
        </option>
      ))}
    </select>
  );

  return (
    <>
      {noAccounts && (
        <p className="error-note">No accounts came back from QuickBooks yet. Click Refresh accounts above.</p>
      )}
      <section className="est-pay">
        <h2 className="est-pay-title">Where money is paid from</h2>
        <p className="est-tax-note">
          Your &ldquo;paid from&rdquo; accounts (Settings › Payment Accounts), matched to your QuickBooks bank and credit card
          accounts. A bill payment goes to QuickBooks from the account it was paid from.
        </p>
        {settings.paidFrom.length ? (
          <table className="qb-table">
            <thead>
              <tr>
                <th>In the CRM</th>
                <th>In QuickBooks</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {settings.paidFrom.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.name}
                    {a.last4 ? ` ••${a.last4}` : ""}
                    <div className="est-tax-note">{KIND[a.kind] ?? a.kind}</div>
                  </td>
                  <td>{select(paid[a.id] ?? "", (v) => setPaid({ ...paid, [a.id]: v }), settings.choices.paidFrom, `QuickBooks account for ${a.name}`)}</td>
                  <td>
                    <span className={`est-badge est-badge-${paid[a.id] ? "signed" : "sent"}`}>{paid[a.id] ? "Matched" : "Pick one"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="est-tax-note">No payment accounts yet. Add them under Settings › Payment Accounts.</p>
        )}
        <p className="est-tax-note">Matched for you where the names agree; change any of them.</p>
      </section>

      <section className="est-pay">
        <h2 className="est-pay-title">Where job costs go</h2>
        <p className="est-tax-note">
          The QuickBooks expense account each bill&apos;s cost lands in. Everything goes to the default unless you match a
          category of your own.
        </p>
        <table className="qb-table">
          <thead>
            <tr>
              <th>Cost category</th>
              <th>QuickBooks account</th>
            </tr>
          </thead>
          <tbody>
            {settings.categories.map((c) => (
              <tr key={c.key || "default"}>
                <td>{c.key ? c.category : <strong>Default</strong>}</td>
                <td>
                  {select(
                    cats[c.key] ?? "",
                    (v) => setCats({ ...cats, [c.key]: v }),
                    settings.choices.expense,
                    `QuickBooks account for ${c.key ? c.category : "the default"}`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {error && <p className="error-note">{error}</p>}
        {saved && <p className="hint-note">Saved.</p>}
        <div className="est-pay-actions">
          <button type="button" className="btn-primary" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save matches"}
          </button>
        </div>
        <p className="est-tax-note">
          Vendors are matched to QuickBooks by name; one QuickBooks doesn&apos;t have yet is added when its first bill goes.
        </p>
      </section>
    </>
  );
}

/** Send invoices to QuickBooks (DECISIONS #184): the switch, the start date, where they go, and how it's going. */
function InvoiceSending({ settings }: { settings: QuickBooksSettings }) {
  const router = useRouter();
  const v = settings.invoices;
  const initial = {
    on: v.on,
    from: v.from ?? v.today,
    jobItem: v.jobItem ?? "",
    depositItem: v.depositItem ?? "",
    costItem: v.costItem ?? "",
    paymentsAccount: v.paymentsAccount ?? "",
    stripeRefundsAccount: v.stripeRefundsAccount ?? "",
    handRefundsAccount: v.handRefundsAccount ?? "",
    sendOutside: v.sendOutside,
  };
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = JSON.stringify({ ...f, from: f.on ? f.from : initial.from }) !== JSON.stringify(initial);
  const set = (patch: Partial<typeof f>) => {
    setF({ ...f, ...patch });
    setMessage(null);
  };

  function save() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await saveQuickBooksInvoiceSending({
        on: f.on,
        from: f.on ? f.from : null,
        jobItem: f.jobItem || null,
        depositItem: f.depositItem || null,
        costItem: f.costItem || null,
        paymentsAccount: f.paymentsAccount || null,
        stripeRefundsAccount: f.stripeRefundsAccount || null,
        handRefundsAccount: f.handRefundsAccount || null,
        sendOutside: f.sendOutside,
      });
      if (res.error) return setError(res.error);
      setMessage(
        f.on
          ? `Saved. Bills to customers dated from ${fmtDate(f.from)} go to QuickBooks within a few minutes.`
          : "Saved. Nothing more goes to QuickBooks; what's there stays."
      );
      router.refresh();
    });
  }

  function sendNow() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const out = sentMessage(await sendInvoicesToQuickBooksNow());
      setMessage(out.message);
      setError(out.error);
      router.refresh();
    });
  }

  const pick = (
    value: string,
    onChange: (val: string) => void,
    options: { id: string; name: string; type?: string }[],
    label: string,
    empty: string
  ) => (
    <select className="qb-select" value={value} onChange={(e) => onChange(e.target.value)} disabled={pending || !v.ready} aria-label={label}>
      <option value="">{empty}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.type ? `${o.name} (${o.type})` : o.name}
        </option>
      ))}
    </select>
  );
  const p = v.prefs;

  return (
    <section className="est-pay">
      <h2 className="est-pay-title">Send invoices to QuickBooks</h2>
      {!v.ready && <p className="error-note">Sending invoices needs a database update first: run 0227_quickbooks_invoices.sql in Supabase.</p>}
      <div className="qb-switch-row">
        <div>
          <strong>Invoices and customer payments</strong>
          <div className="est-tax-note">
            On: each bill to a customer goes a few minutes after it&apos;s billed, and each payment a few minutes after it
            comes in, or once it clears. Drafts never go.
          </div>
        </div>
        <button
          type="button"
          className="ur-toggle-btn"
          aria-pressed={f.on}
          aria-label="Send invoices and customer payments to QuickBooks"
          disabled={pending || !v.ready}
          onClick={() => set({ on: !f.on })}
        >
          <span className={"toggle-track" + (f.on ? " toggle-on" : "")}>
            <span className="toggle-thumb" />
          </span>
        </button>
      </div>
      {f.on && (
        <>
          <label className="field qb-from">
            <span className="field-label">Start with invoices dated from</span>
            <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} disabled={pending} />
          </label>
          <p className="est-tax-note">
            Bills to customers dated before this stay out of QuickBooks, and so do their payments, so the ones your bookkeeper
            already typed in aren&apos;t doubled. This is separate from the start date for Bills to Pay.
          </p>
        </>
      )}

      <h3 className="qb-subhead">Where they go in QuickBooks</h3>
      {!v.items.length && (
        <p className="est-tax-note">No products or services read from QuickBooks yet. Click Refresh accounts above.</p>
      )}
      <div className="qb-picks">
        <label className="qb-pick">
          <span>Product or service for job work</span>
          {pick(f.jobItem, (val) => set({ jobItem: val }), v.items, "Product or service for job work", "Pick one")}
        </label>
        <label className="qb-pick">
          <span>Deposits</span>
          {pick(f.depositItem, (val) => set({ depositItem: val }), v.items, "Product or service for deposits", "Same as job work")}
        </label>
        <label className="qb-pick">
          <span>Costs billed back</span>
          {pick(f.costItem, (val) => set({ costItem: val }), v.items, "Product or service for costs billed back", "Same as job work")}
        </label>
        <label className="qb-pick">
          <span>Customer payments go to</span>
          {pick(f.paymentsAccount, (val) => set({ paymentsAccount: val }), v.choices.deposit, "Where customer payments go", "Payments to deposit")}
        </label>
        <p className="est-tax-note">
          Payments to deposit is QuickBooks&apos; holding spot for money that hasn&apos;t reached the bank yet (some files call it
          Undeposited Funds). Your bookkeeper groups these into bank deposits there, as today.
        </p>
        <label className="qb-pick">
          <span>Refunds made in Stripe come out of</span>
          {pick(f.stripeRefundsAccount, (val) => set({ stripeRefundsAccount: val }), v.choices.deposit, "Where Stripe refunds come out of", "Payments to deposit")}
        </label>
        <p className="est-tax-note">Stripe takes them off its next payout, so they come off that bank deposit too.</p>
        <label className="qb-pick">
          <span>Refunds you record by hand come from</span>
          {pick(f.handRefundsAccount, (val) => set({ handRefundsAccount: val }), v.choices.bank, "Where refunds by hand come from", "Pick an account")}
        </label>
        <label className="qb-pick">
          <span>
            Customers invoiced outside the CRM <span className="est-tax-note">(Online payments off on their client card)</span>
          </span>
          <select
            className="qb-select"
            value={f.sendOutside ? "send" : "out"}
            onChange={(e) => set({ sendOutside: e.target.value === "send" })}
            disabled={pending || !v.ready}
            aria-label="Customers invoiced outside the CRM"
          >
            <option value="out">Leave them out</option>
            <option value="send">Send them too</option>
          </select>
        </label>
      </div>

      <h3 className="qb-subhead">Your QuickBooks</h3>
      {p ? (
        <ul className="qb-prefs">
          <li>
            <span>
              Custom transaction numbers <span className="est-tax-note">(keeps the CRM&apos;s invoice numbers)</span>
            </span>
            <span className={p.customNumbers ? "qb-ok" : undefined}>{p.customNumbers ? "On ✓" : "Off: QuickBooks numbers them"}</span>
          </li>
          <li>
            <span>
              Automatically apply credits <span className="est-tax-note">(keep it off, or QuickBooks puts credits on the oldest invoice)</span>
            </span>
            <span className={p.autoApplyCredit ? "qb-bad" : "qb-ok"}>{p.autoApplyCredit ? "On: credits wait" : "Off ✓"}</span>
          </li>
          <li>
            <span>Sales tax</span>
            <span>{p.salesTax ? (p.automaticTax ? "On, automatic" : "On") : "Off"}</span>
          </li>
          <li>
            <span>Books closed through</span>
            <span>{p.bookCloseDate ? fmtDate(p.bookCloseDate) : "Not closed"}</span>
          </li>
        </ul>
      ) : (
        <p className="est-tax-note">Read from QuickBooks on the first run.</p>
      )}

      {settings.connection?.environment === "sandbox" && (
        <p className="est-tax-note">This sends to your practice company, so you can see it work before your real books.</p>
      )}
      {error && <p className="error-note">{error}</p>}
      {message && <p className="hint-note">{message}</p>}
      {changed && (
        <div className="est-pay-actions">
          <button type="button" className="btn-primary" onClick={save} disabled={pending || !v.ready || (f.on && (!f.from || !f.jobItem))}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {v.on && (
        <>
          <div className="qb-counts">
            <div className="qb-count">
              <b>{v.counts.sent}</b>
              <span>In QuickBooks</span>
            </div>
            <div className="qb-count">
              <b>{v.counts.waiting}</b>
              <span>Waiting</span>
            </div>
            <div className={"qb-count" + (v.counts.failed ? " is-failed" : "")}>
              <b>{v.counts.failed}</b>
              <span>Didn&apos;t go</span>
            </div>
          </div>
          {v.attention.length > 0 && (
            <>
              <h3 className="qb-subhead">Needs a look</h3>
              <ul className="qb-attention">
                {v.attention.map((a, i) => (
                  <li key={i} className={a.status === "waiting" ? undefined : "is-failed"}>
                    <strong>
                      {a.customer}
                      {a.amountCents !== null ? ` · ${money(a.amountCents)}` : ""} {a.what}
                    </strong>
                    {a.day ? ` on ${fmtDate(a.day)}` : ""}
                    <div className="est-tax-note">{a.reason}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="est-pay-actions qb-send-row">
            <button type="button" className="btn-ghost" onClick={sendNow} disabled={pending || changed}>
              {pending ? "Sending…" : "Send now"}
            </button>
            <span className="est-tax-note" suppressHydrationWarning>
              {v.checkedAt ? `Last checked ${ago(v.checkedAt)}` : "Not checked yet: the first run is within five minutes."}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
