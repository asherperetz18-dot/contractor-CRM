"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePaymentAccount, setPaymentAccountArchived } from "@/lib/actions/payment-accounts";
import { PAYMENT_ACCOUNT_KIND_LABEL, type PaymentAccount } from "@/lib/data/bills";

type Draft = { id?: string; name: string; kind: PaymentAccount["kind"]; last4: string };
const BLANK: Draft = { name: "", kind: "bank", last4: "" };

export function PaymentAccountsView({
  accounts,
  canEdit,
}: {
  accounts: PaymentAccount[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ error?: string }>, after?: () => void) {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (res.error) return setError(res.error);
      after?.();
      router.refresh();
    });
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Payment Accounts</h1>
          <p className="module-sub">
            The bank accounts, cards and cash that bills are paid from &mdash; the &ldquo;Paid
            from&rdquo; on every bill payment. When QuickBooks is connected, each one is matched to
            its QuickBooks account.
          </p>
        </div>
        {canEdit && !draft && (
          <button className="btn-primary" onClick={() => setDraft(BLANK)}>
            + Add account
          </button>
        )}
      </div>

      {error && <p className="error-note">{error}</p>}

      {draft && (
        <div className="qr-form" style={{ maxWidth: 520, marginBottom: 18 }}>
          <label className="field">
            <span className="field-label">Name</span>
            <input
              autoFocus
              placeholder="e.g. Chase Business Checking"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <div className="qr-pair">
            <label className="field">
              <span className="field-label">Type</span>
              <select
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as PaymentAccount["kind"] })}
              >
                {(Object.keys(PAYMENT_ACCOUNT_KIND_LABEL) as PaymentAccount["kind"][]).map((k) => (
                  <option key={k} value={k}>
                    {PAYMENT_ACCOUNT_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Last 4 (optional)</span>
              <input
                inputMode="numeric"
                maxLength={4}
                value={draft.last4}
                onChange={(e) => setDraft({ ...draft, last4: e.target.value })}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn-primary"
              disabled={pending}
              onClick={() => run(() => savePaymentAccount(draft), () => setDraft(null))}
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button className="btn-ghost" disabled={pending} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">No accounts yet</p>
          <p className="empty-hint">
            Add the checking account and cards you pay vendors from. They show up as &ldquo;Paid
            from&rdquo; when you add a bill.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Last 4</th>
                <th>QuickBooks account</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} style={a.archived_at ? { opacity: 0.55 } : undefined}>
                  <td>
                    <strong>{a.name}</strong>
                    {a.archived_at && <div className="est-tax-note">Archived</div>}
                  </td>
                  <td>{PAYMENT_ACCOUNT_KIND_LABEL[a.kind]}</td>
                  <td className="mono">{a.last4 ?? "—"}</td>
                  <td className="est-tax-note">
                    {a.qb_account_id ? "Linked" : "Linked when QuickBooks is connected"}
                  </td>
                  {canEdit && (
                    <td className="right">
                      <button
                        className="btn-ghost small"
                        disabled={pending}
                        onClick={() =>
                          setDraft({ id: a.id, name: a.name, kind: a.kind, last4: a.last4 ?? "" })
                        }
                      >
                        Edit
                      </button>{" "}
                      <button
                        className="btn-ghost small"
                        disabled={pending}
                        onClick={() => run(() => setPaymentAccountArchived(a.id, !a.archived_at))}
                      >
                        {a.archived_at ? "Restore" : "Archive"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
