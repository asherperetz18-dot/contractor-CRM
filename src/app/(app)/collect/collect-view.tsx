"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import "./collect.css";
import {
  MANUAL_PAYMENT_METHODS,
  centsFromInput,
  moneyCents,
  type ManualPaymentMethod,
} from "@/lib/data/types";
import { requestPhaseNow } from "@/lib/actions/receivables";
import { recordManualPayment } from "@/lib/actions/manual-payments";

export type ReceivableRow = {
  phaseId: string;
  estimateId: string;
  leadId: string;
  title: string;
  phase: string;
  requestedAt: string;
  dueDate: string | null;
  remainingCents: number;
  customer: string;
  address: string | null;
  rep: string | null;
};

export type BillableRow = {
  phaseId: string;
  estimateId: string;
  leadId: string;
  title: string;
  phase: string;
  amountCents: number;
  customer: string;
  address: string | null;
  rep: string | null;
};

const DAY = 86400000;
const ageDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY);

export function CollectView({
  unpaid,
  billable,
}: {
  unpaid: ReceivableRow[];
  billable: BillableRow[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<"unpaid" | "billable">("unpaid");
  const [search, setSearch] = useState("");
  // Client and rep live in the URL (?client=<leadId>&rep=<name>) so a
  // filtered view can be bookmarked or pasted to a teammate before a
  // collections call. Read once on load; written back on every change.
  const [clientId, setClientId] = useState(() => params.get("client") ?? "");
  const [rep, setRep] = useState(() => params.get("rep") ?? "");
  const [collecting, setCollecting] = useState<ReceivableRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const next = new URLSearchParams(window.location.search);
    if (clientId) next.set("client", clientId);
    else next.delete("client");
    if (rep) next.set("rep", rep);
    else next.delete("rep");
    const qs = next.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [clientId, rep]);

  // Dropdown choices come from the rows themselves, so a client or rep
  // only appears when they actually have money on this page; the count
  // next to each name is how many rows they own across both tabs.
  const allRows: { leadId: string; customer: string; rep: string | null }[] = [
    ...unpaid,
    ...billable,
  ];
  const clients = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number }>();
    for (const r of allRows) {
      const c = m.get(r.leadId) ?? { id: r.leadId, name: r.customer, count: 0 };
      c.count += 1;
      m.set(r.leadId, c);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unpaid, billable]);
  const reps = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allRows) if (r.rep) m.set(r.rep, (m.get(r.rep) ?? 0) + 1);
    return [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unpaid, billable]);

  // Client + rep narrow everything on the page -- the stat cards, the
  // aging bar, the tab counts and the table -- so the numbers up top are
  // always "what this client owes", not company-wide totals over a
  // filtered list. The text search only narrows the table.
  const scoped = (r: { leadId: string; rep: string | null }) =>
    (!clientId || r.leadId === clientId) && (!rep || r.rep === rep);
  const scopedUnpaid = unpaid.filter(scoped);
  const scopedBillable = billable.filter(scoped);
  const filtering = Boolean(clientId || rep);

  const buckets = {
    current: scopedUnpaid.filter((r) => ageDays(r.requestedAt) <= 30),
    mid: scopedUnpaid.filter((r) => ageDays(r.requestedAt) > 30 && ageDays(r.requestedAt) <= 90),
    old: scopedUnpaid.filter((r) => ageDays(r.requestedAt) > 90),
  };
  const sum = (rows: { remainingCents: number }[]) =>
    rows.reduce((s, r) => s + r.remainingCents, 0);
  const totalOut = sum(scopedUnpaid);
  const billableTotal = scopedBillable.reduce((s, r) => s + r.amountCents, 0);

  const q = search.trim().toLowerCase();
  const match = (r: { title: string; phase: string; customer: string }) =>
    !q ||
    r.title.toLowerCase().includes(q) ||
    r.phase.toLowerCase().includes(q) ||
    r.customer.toLowerCase().includes(q);
  const shownUnpaid = scopedUnpaid.filter(match);
  const shownBillable = scopedBillable.filter(match);

  async function run(fn: () => Promise<{ error?: string; ok?: boolean; warning?: string }>) {
    setBusy(true);
    setError("");
    const res = await fn();
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return false;
    }
    router.refresh();
    return true;
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString(undefined, {
          month: "2-digit",
          day: "2-digit",
          year: "numeric",
        })
      : "—";

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Money to Collect</h1>
          <p className="module-sub">
            Outstanding receivables · unpaid invoices sorted oldest first · {scopedUnpaid.length} open
          </p>
        </div>
      </div>

      <div className="stat-grid stat-grid-5">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(totalOut)}</div>
          <div className="stat-label">Total Outstanding</div>
        </div>
        <div className={"stat-card stat-static" + (buckets.old.length ? " digest-urgent" : "")}>
          <div className="stat-value mono">{moneyCents(sum(buckets.old))}</div>
          <div className="stat-label">90+ Days · {buckets.old.length} urgent</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(sum(buckets.mid))}</div>
          <div className="stat-label">31–90 Days · {buckets.mid.length} follow up</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(sum(buckets.current))}</div>
          <div className="stat-label">Current (0–30) · {buckets.current.length} on track</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(billableTotal)}</div>
          <div className="stat-label">Billable Now · {scopedBillable.length} phases not invoiced</div>
        </div>
      </div>

      {totalOut > 0 && (
        <div className="collect-aging" aria-hidden>
          <span
            className="collect-aging-current"
            style={{ flexGrow: Math.max(sum(buckets.current), 1) }}
          />
          <span className="collect-aging-mid" style={{ flexGrow: Math.max(sum(buckets.mid), 1) }} />
          <span className="collect-aging-old" style={{ flexGrow: Math.max(sum(buckets.old), 1) }} />
        </div>
      )}

      <div className="filter-bar">
        <button
          type="button"
          className={"chip" + (tab === "unpaid" ? " chip-active" : "")}
          onClick={() => setTab("unpaid")}
        >
          Unpaid Invoices{" "}
          {scopedUnpaid.length > 0 && <span className="count-pill">{scopedUnpaid.length}</span>}
        </button>
        <button
          type="button"
          className={"chip" + (tab === "billable" ? " chip-active" : "")}
          onClick={() => setTab("billable")}
        >
          Billable Now{" "}
          {scopedBillable.length > 0 && (
            <span className="count-pill">{scopedBillable.length}</span>
          )}
        </button>
        <ClientPicker
          clients={clients}
          value={clientId}
          onChange={setClientId}
        />
        <select
          className="ur-company-filter"
          aria-label="Filter by rep"
          value={rep}
          onChange={(e) => setRep(e.target.value)}
        >
          <option value="">All reps</option>
          {reps.map((r) => (
            <option key={r.name} value={r.name}>
              {r.name} ({r.count})
            </option>
          ))}
        </select>
        {filtering && (
          <button
            type="button"
            className="btn-ghost small"
            onClick={() => {
              setClientId("");
              setRep("");
            }}
          >
            ✕ Clear
          </button>
        )}
        <input
          className="ur-search"
          style={{ maxWidth: 320, marginBottom: 0, marginLeft: "auto" }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects, phases, customers…"
        />
      </div>

      {error && <p className="error-note">{error}</p>}

      {tab === "unpaid" ? (
        shownUnpaid.length === 0 ? (
          <div className="empty-state">
            <p className="empty-label">Nothing outstanding</p>
            <p className="empty-hint">
              {filtering || q
                ? "No unpaid invoice matches these filters."
                : "Every requested phase is paid — the good outcome."}
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rep</th>
                  <th>Project</th>
                  <th>Phase / Draw</th>
                  <th>Inv. Date</th>
                  <th className="right">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shownUnpaid.map((r) => {
                  const age = ageDays(r.requestedAt);
                  return (
                    <tr key={r.phaseId}>
                      <td>{r.rep ?? "—"}</td>
                      <td>
                        <Link href={`/estimates/${r.estimateId}`} className="ur-name">
                          {r.title}
                        </Link>
                        <div className="est-tax-note">
                          {r.customer}
                          {r.address ? ` · ${r.address}` : ""}
                        </div>
                      </td>
                      <td>{r.phase}</td>
                      <td className="mono">
                        {fmt(r.requestedAt)}
                        <div
                          className={
                            "est-tax-note" + (age > 90 ? " proj-check-overdue" : "")
                          }
                        >
                          {age}d ago
                        </div>
                      </td>
                      <td className="right mono">{moneyCents(r.remainingCents)}</td>
                      <td className="right">
                        <button
                          className="btn-primary small"
                          disabled={busy}
                          onClick={() => setCollecting(r)}
                        >
                          💵 Record payment
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : shownBillable.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">Everything is invoiced</p>
          <p className="empty-hint">
            {filtering || q
              ? "No billable phase matches these filters."
              : "No phase on a signed contract is waiting to be billed."}
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rep</th>
                <th>Project</th>
                <th>Phase / Draw</th>
                <th className="right">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shownBillable.map((r) => (
                <tr key={r.phaseId}>
                  <td>{r.rep ?? "—"}</td>
                  <td>
                    <Link href={`/estimates/${r.estimateId}`} className="ur-name">
                      {r.title}
                    </Link>
                    <div className="est-tax-note">
                      {r.customer}
                      {r.address ? ` · ${r.address}` : ""}
                    </div>
                  </td>
                  <td>{r.phase}</td>
                  <td className="right mono">{moneyCents(r.amountCents)}</td>
                  <td className="right">
                    <button
                      className="btn-primary small"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Bill "${r.phase}" (${moneyCents(r.amountCents)}) now? It lands on the customer's portal with a one-week due date. Nothing is sent.`
                          )
                        )
                          void run(() => requestPhaseNow(r.phaseId));
                      }}
                    >
                      Request now
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {collecting && (
        <CollectPaymentModal
          row={collecting}
          busy={busy}
          onSave={async (input) => {
            const ok = await run(() =>
              recordManualPayment({
                estimateId: collecting.estimateId,
                phaseId: collecting.phaseId,
                ...input,
              })
            );
            if (ok) setCollecting(null);
          }}
          onClose={() => setCollecting(null)}
        />
      )}
    </div>
  );
}

/**
 * Type-to-find client picker. A plain <select> stops being usable past a
 * few dozen customers, and Money to Collect grows with every signed
 * contract, so this is an input that narrows a list as you type. Only
 * clients with something on the page are offered, each with a row count.
 */
function ClientPicker({
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
  // outside (Clear button, back/forward, a pasted link).
  useEffect(() => {
    setText(selected?.name ?? "");
  }, [selected?.name]);

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
    <div ref={wrap} className="collect-client-picker">
      <input
        className="ur-company-filter"
        style={{ width: 220, paddingRight: value ? 28 : undefined }}
        role="combobox"
        aria-label="Filter by client"
        aria-expanded={open}
        aria-controls="collect-client-list"
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
          className="collect-client-clear"
          aria-label="Clear client filter"
          onClick={() => pick(null)}
        >
          ×
        </button>
      )}
      {open && (
        <ul id="collect-client-list" role="listbox" className="collect-client-list">
          <li
            role="option"
            aria-selected={!value}
            className={"collect-client-opt" + (!value ? " is-selected" : "")}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(null);
            }}
          >
            All clients
          </li>
          {hits.length === 0 && (
            <li className="collect-client-opt is-empty">No client matches “{text}”</li>
          )}
          {hits.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={c.id === value}
              className={
                "collect-client-opt" +
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

function CollectPaymentModal({
  row,
  busy,
  onSave,
  onClose,
}: {
  row: ReceivableRow;
  busy: boolean;
  onSave: (input: {
    amountCents: number;
    method: ManualPaymentMethod;
    reference?: string;
    receivedOn?: string;
    cleared?: boolean;
  }) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState((row.remainingCents / 100).toFixed(2));
  const [method, setMethod] = useState<ManualPaymentMethod>("check");
  const [reference, setReference] = useState("");
  const [receivedOn, setReceivedOn] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [cleared, setCleared] = useState(true);

  return (
    <Modal
      title={`Record payment — ${row.customer}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="module-sub" style={{ marginTop: 0 }}>
        {moneyCents(row.remainingCents)} outstanding on {row.phase} ({row.title}).
      </p>
      <div className="qr-form">
        <div className="qr-pair">
          <label className="field">
            <span>Amount</span>
            <input
              inputMode="decimal"
              value={amount}
              disabled={busy}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Method</span>
            <select
              value={method}
              disabled={busy}
              onChange={(e) => setMethod(e.target.value as ManualPaymentMethod)}
            >
              {MANUAL_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="qr-pair">
          <label className="field">
            <span>Received on</span>
            <input
              type="date"
              value={receivedOn}
              disabled={busy}
              onChange={(e) => setReceivedOn(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Reference</span>
            <input
              value={reference}
              disabled={busy}
              onChange={(e) => setReference(e.target.value)}
              placeholder="check # (optional)"
            />
          </label>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={cleared}
            disabled={busy}
            onChange={(e) => setCleared(e.target.checked)}
          />
          Money has arrived (uncheck for a cheque not yet banked)
        </label>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() =>
            onSave({ amountCents: centsFromInput(amount), method, reference, receivedOn, cleared })
          }
        >
          {busy ? "Recording…" : "Record payment"}
        </button>
      </div>
    </Modal>
  );
}
