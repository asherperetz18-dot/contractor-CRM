"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  disconnectQuickBooks,
  refreshQuickBooksAccounts,
  saveQuickBooksMatches,
  type QuickBooksSettings,
} from "@/lib/actions/quickbooks";

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const KIND: Record<string, string> = { bank: "Bank account", credit_card: "Card", cash: "Cash" };

/**
 * Settings › QuickBooks (DECISIONS #171): connect the company's
 * QuickBooks Online, then match its accounts. This step writes nothing to
 * QuickBooks; the next ones send bills, then invoices and payments.
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

        <h3 className="qb-subhead">How it will work</h3>
        <ul className="qb-rules">
          <li>One way: from the CRM to QuickBooks. The CRM never changes or deletes anything you entered in QuickBooks.</li>
          <li>
            Each bill, invoice and payment goes once and is marked <strong>Synced</strong>, so nothing is entered twice.
          </li>
          <li>Anything that can&apos;t go says why, on its row, and goes as soon as it&apos;s fixed.</li>
          <li>Disconnect any time. What&apos;s already in QuickBooks stays there.</li>
        </ul>
        <h3 className="qb-subhead">The plan</h3>
        <ol className="qb-plan">
          <li className="is-now">
            <strong>Connect, and match your accounts</strong> <span className="est-badge est-badge-financing">this step</span>
          </li>
          <li>Bills and bill payments go to QuickBooks</li>
          <li>Customers, invoices and customer payments</li>
          <li>Job costs, including lender fees</li>
        </ol>
      </section>

      {connected && <MatchForm settings={settings} />}
    </>
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
