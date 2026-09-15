"use client";

import { useEffect, useRef, useState } from "react";
import "./client-picker.css";

/**
 * Type-to-find client picker, shared by Money to Collect and Payments. A
 * plain <select> stops being usable past a few dozen customers, and both
 * pages grow with every signed contract, so this is an input that narrows
 * a list as you type. Callers pass only clients with something on the
 * page, each with a row count.
 */
export function ClientPicker({
  clients,
  value,
  onChange,
}: {
  clients: { id: string; name: string; count: number }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const selected = clients.find((c) => c.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(selected?.name ?? "");
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  // Keep the box showing the chosen name when the value changes from
  // outside (Clear button, back/forward, a pasted link). Adjusted during
  // render, not in an effect, so the stale text never paints.
  const [shownFor, setShownFor] = useState(selected?.name ?? "");
  if ((selected?.name ?? "") !== shownFor) {
    setShownFor(selected?.name ?? "");
    setText(selected?.name ?? "");
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        setOpen(false);
        setText(selected?.name ?? "");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, selected?.name]);

  const needle = text.trim().toLowerCase();
  const hits =
    needle && needle !== selected?.name.toLowerCase()
      ? clients.filter((c) => c.name.toLowerCase().includes(needle))
      : clients;

  function pick(c: { id: string; name: string } | null) {
    onChange(c?.id ?? "");
    setText(c?.name ?? "");
    setOpen(false);
  }

  return (
    <div ref={wrap} className="client-picker">
      <input
        className="ur-company-filter"
        style={{ width: 220, paddingRight: value ? 28 : undefined }}
        role="combobox"
        aria-label="Filter by client"
        aria-expanded={open}
        aria-controls="client-picker-list"
        value={text}
        placeholder="All clients"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
          if (!e.target.value) onChange("");
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && hits[active]) pick(hits[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
            setText(selected?.name ?? "");
          }
        }}
      />
      {value && (
        <button
          type="button"
          className="client-picker-clear"
          aria-label="Clear client filter"
          onClick={() => pick(null)}
        >
          ×
        </button>
      )}
      {open && (
        <ul id="client-picker-list" role="listbox" className="client-picker-list">
          <li
            role="option"
            aria-selected={!value}
            className={"client-picker-opt" + (!value ? " is-selected" : "")}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(null);
            }}
          >
            All clients
          </li>
          {hits.length === 0 && (
            <li className="client-picker-opt is-empty">No client matches “{text}”</li>
          )}
          {hits.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={c.id === value}
              className={
                "client-picker-opt" +
                (i === active ? " is-active" : "") +
                (c.id === value ? " is-selected" : "")
              }
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              <span>{c.name}</span>
              <span className="count-pill">{c.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
