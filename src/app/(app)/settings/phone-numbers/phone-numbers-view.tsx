"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  refreshPhoneNumbersFromTwilio,
  removePhoneNumber,
  setDefaultPhoneNumber,
  updatePhoneNumberLabel,
  type CompanyPhoneNumber,
} from "@/lib/actions/phone-numbers";

export function PhoneNumbersView({ initial }: { initial: CompanyPhoneNumber[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // Labels edit in place; everything else re-renders from the server.
  const [labels, setLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.map((n) => [n.id, n.label ?? ""]))
  );

  function run(fn: () => Promise<{ error?: string }>, doneMsg?: string) {
    setError("");
    setMessage("");
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else if (doneMsg) setMessage(doneMsg);
      router.refresh();
    });
  }

  function handleRefresh() {
    setError("");
    setMessage("");
    startTransition(async () => {
      const res = await refreshPhoneNumbersFromTwilio();
      if (res.error) {
        setError(res.error);
      } else {
        setMessage(
          `${res.total} number${res.total === 1 ? "" : "s"} registered` +
            (res.added ? ` (${res.added} new)` : "") +
            (res.webhooksSet
              ? ` · ${res.webhooksSet} pointed at the CRM for callbacks`
              : "")
        );
      }
      router.refresh();
    });
  }

  return (
    <div>
      <p className="hint-note">
        Buy numbers in the Twilio console (Phone Numbers → Buy a Number), then refresh
        here — new numbers register themselves and their callbacks are routed into the
        CRM. Texting stays on the default number.
      </p>

      <div style={{ margin: "12px 0" }}>
        <button className="btn-primary" onClick={handleRefresh} disabled={pending}>
          {pending ? "Working…" : "Refresh from Twilio"}
        </button>
      </div>

      {message && <p className="hint-note">{message}</p>}
      {error && <p className="error-note">{error}</p>}

      {initial.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">No numbers registered</p>
          <p className="empty-hint">
            Refresh from Twilio to pull in the numbers this company&apos;s account owns.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Label</th>
                <th>Default</th>
                <th className="right"></th>
              </tr>
            </thead>
            <tbody>
              {initial.map((n) => (
                <tr key={n.id}>
                  <td className="mono">{n.phone_number}</td>
                  <td>
                    <input
                      value={labels[n.id] ?? ""}
                      placeholder="e.g. West LA line"
                      onChange={(e) =>
                        setLabels((prev) => ({ ...prev, [n.id]: e.target.value }))
                      }
                      onBlur={() => {
                        if ((labels[n.id] ?? "") !== (n.label ?? "")) {
                          run(() => updatePhoneNumberLabel(n.id, labels[n.id] ?? ""));
                        }
                      }}
                      disabled={pending}
                    />
                  </td>
                  <td>
                    <input
                      type="radio"
                      name="default-number"
                      checked={n.is_default}
                      onChange={() =>
                        run(() => setDefaultPhoneNumber(n.id), "Default updated.")
                      }
                      disabled={pending}
                    />
                  </td>
                  <td className="right">
                    {!n.is_default && (
                      <button
                        className="btn-ghost small"
                        onClick={() =>
                          run(
                            () => removePhoneNumber(n.id),
                            "Removed from the list — the number is still owned in Twilio."
                          )
                        }
                        disabled={pending}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
