"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetNavOrder, saveNavOrder } from "@/lib/actions/nav-order";

type Row = { key: string; label: string; icon: string };

export function MenuOrderView({
  rows: initial,
  hasCustomOrder,
}: {
  rows: Row[];
  hasCustomOrder: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const dirty = rows.some((r, i) => r.key !== initial[i]?.key);

  function move(index: number, delta: -1 | 1) {
    setSaved(false);
    setRows((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function save() {
    setError("");
    startTransition(async () => {
      const res = await saveNavOrder(rows.map((r) => r.key));
      if (res.error) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  function reset() {
    setError("");
    startTransition(async () => {
      const res = await resetNavOrder();
      if (res.error) {
        setError(res.error);
        return;
      }
      setSaved(false);
      router.refresh();
    });
  }

  return (
    <div className="menu-order-wrap">
      <p className="hint-note">
        Move sections and pages up or down — the sidebar updates for everyone once you
        save. Admin Settings always stays at the bottom.
      </p>

      <ul className="menu-order-list">
        {rows.map((r, i) => (
          <li key={r.key} className="menu-order-row">
            <span className="menu-order-label">
              <span className="menu-order-icon">{r.icon}</span> {r.label}
            </span>
            <span className="menu-order-btns">
              <button
                className="btn-ghost small"
                onClick={() => move(i, -1)}
                disabled={i === 0 || pending}
                aria-label={`Move ${r.label} up`}
              >
                ↑
              </button>
              <button
                className="btn-ghost small"
                onClick={() => move(i, 1)}
                disabled={i === rows.length - 1 || pending}
                aria-label={`Move ${r.label} down`}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ul>

      {error && <p className="error-note">{error}</p>}

      <div className="menu-order-actions">
        <button className="btn-primary" onClick={save} disabled={!dirty || pending}>
          {pending ? "Saving…" : dirty ? "Save order" : saved ? "Saved" : "Save order"}
        </button>
        {hasCustomOrder && (
          <button className="btn-ghost" onClick={reset} disabled={pending}>
            Reset to standard order
          </button>
        )}
      </div>
    </div>
  );
}
