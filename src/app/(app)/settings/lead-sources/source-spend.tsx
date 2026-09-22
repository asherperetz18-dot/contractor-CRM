"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMarketingSpend, setSourceBoughtList } from "@/lib/actions/marketing-spend";

export type SourceLine = { id: string | null; name: string; boughtList: boolean };
export type SpendLine = { source: string; amount_cents: number; note: string | null };

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const dollars = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, "");

/**
 * What each source cost in a month, and which sources are bought lists.
 *
 * The analytics page divides a month's spend over that month's leads and
 * sales, so cost per lead stops reading the $375 default on every row.
 * One amount per source per month -- the vendor's invoice, the ad
 * budget -- typed here by the office.
 */
export function SourceSpend({
  month,
  sources,
  spend,
}: {
  /** YYYY-MM, from the page's ?month= query. */
  month: string;
  sources: SourceLine[];
  /** This month's rows; null while migration 0165 hasn't run. */
  spend: SpendLine[] | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");

  const byName = useMemo(() => new Map((spend ?? []).map((s) => [s.source, s])), [spend]);
  // Configured sources first, then any source with spend this month that
  // isn't on the list -- the list is not the truth of what's on leads.
  const lines = useMemo(() => {
    const seen = new Set(sources.map((s) => s.name));
    const extra = (spend ?? [])
      .filter((s) => !seen.has(s.source))
      .map((s) => ({ id: null, name: s.source, boughtList: false }));
    return [...sources, ...extra];
  }, [sources, spend]);
  const total = (spend ?? []).reduce((s, x) => s + x.amount_cents, 0);

  /** Saves one amount; true when it landed, so callers only clear on success. */
  async function save(name: string, text: string): Promise<boolean> {
    const amount = Number(text.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Enter a dollar amount, zero or more.");
      return false;
    }
    setBusy(name);
    setError("");
    const res = await saveMarketingSpend(name, month, Math.round(amount * 100));
    setBusy(null);
    if (res.error) {
      setError(res.error);
      return false;
    }
    setDrafts((d) => {
      const next = { ...d };
      delete next[name];
      return next;
    });
    startTransition(() => router.refresh());
    return true;
  }

  async function toggleBought(id: string, value: boolean) {
    setError("");
    const res = await setSourceBoughtList(id, value);
    if (res.error) {
      setError(res.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="settings-section mkt-spend" id="spend">
      <div className="settings-section-head">
        <span className="settings-section-title">SPEND BY SOURCE</span>
        <span className="settings-section-hint">
          What you paid each source in a month. Marketing Analytics divides it over that month&apos;s
          leads and sales.
        </span>
      </div>
      {spend === null ? (
        <p className="empty-hint">
          Spend tracking isn&apos;t set up yet — run migration <code>0165_marketing_spend.sql</code> in
          the Supabase SQL editor.
        </p>
      ) : (
        <>
          <div className="mkt-month-nav">
            <Link className="btn-ghost small" href={`?month=${shiftMonth(month, -1)}#spend`} scroll={false}>
              ‹ {monthLabel(shiftMonth(month, -1))}
            </Link>
            <strong>{monthLabel(month)}</strong>
            <Link className="btn-ghost small" href={`?month=${shiftMonth(month, 1)}#spend`} scroll={false}>
              {monthLabel(shiftMonth(month, 1))} ›
            </Link>
            <span className="mkt-month-total mono">
              {total > 0 ? `$${(total / 100).toLocaleString("en-US")} entered` : "nothing entered yet"}
            </span>
          </div>
          {error && <p className="error-note">{error}</p>}
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Bought list</th>
                <th className="right">Spend in {monthLabel(month)}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((s) => {
                const saved = byName.get(s.name);
                const savedText = saved ? dollars(saved.amount_cents) : "";
                const text = drafts[s.name] ?? savedText;
                const dirty = text !== savedText;
                return (
                  <tr key={s.name}>
                    <td>
                      {s.name}
                      {!s.id && <span className="ur-add-phone"> not in the source list</span>}
                    </td>
                    <td>
                      {s.id ? (
                        <label className="est-record-check">
                          <input
                            type="checkbox"
                            checked={s.boughtList}
                            onChange={(e) => toggleBought(s.id as string, e.target.checked)}
                          />{" "}
                          <span>bought list</span>
                        </label>
                      ) : (
                        <span className="ur-add-phone">—</span>
                      )}
                    </td>
                    <td className="right">
                      <span className="mkt-money-input">
                        $
                        <input
                          id={`spend-${s.name}`}
                          type="text"
                          inputMode="decimal"
                          value={text}
                          placeholder="0"
                          onChange={(e) => setDrafts((d) => ({ ...d, [s.name]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void save(s.name, text);
                          }}
                          aria-label={`Spend for ${s.name}`}
                        />
                      </span>
                    </td>
                    <td className="right">
                      {dirty && (
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={busy === s.name}
                          onClick={() => save(s.name, text)}
                        >
                          {busy === s.name ? "Saving…" : "Save"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="mkt-spend-new">
                <td colSpan={2}>
                  <input
                    id="spend-new-source"
                    type="text"
                    className="mkt-source-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Another source, spelled as it appears on leads"
                    aria-label="Source name"
                    list="mkt-source-names"
                  />
                  <datalist id="mkt-source-names">
                    {sources.map((s) => (
                      <option key={s.name} value={s.name} />
                    ))}
                  </datalist>
                </td>
                <td className="right">
                  <span className="mkt-money-input">
                    $
                    <input
                      id="spend-new-amount"
                      type="text"
                      inputMode="decimal"
                      value={newAmount}
                      placeholder="0"
                      onChange={(e) => setNewAmount(e.target.value)}
                      aria-label="Spend amount"
                    />
                  </span>
                </td>
                <td className="right">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!newName.trim() || !newAmount.trim() || busy !== null}
                    onClick={async () => {
                      if (await save(newName.trim(), newAmount)) {
                        setNewName("");
                        setNewAmount("");
                      }
                    }}
                  >
                    Add
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="hint-note">
            Enter the vendor&apos;s invoice or the month&apos;s ad budget. A report window that covers
            part of a month claims that share of it, and never a day that hasn&apos;t happened yet.
          </p>
        </>
      )}
    </div>
  );
}
