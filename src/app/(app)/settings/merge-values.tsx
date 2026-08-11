"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/data/types";
import {
  getFieldValueUsage,
  mergeFieldValues,
  type FieldValueCluster,
  type FieldValueUsage,
  type OptionTable,
} from "@/lib/actions/lead-field-options";

/**
 * Folding several spellings of one value into a single one.
 *
 * Reads the values off the leads rather than the settings list, because
 * most of them were never added to it -- typed straight onto a lead, or
 * carried in by an import. A tool that could only see the configured
 * options would be blind to the actual mess.
 */
export function MergeValues({ table, itemLabel }: { table: OptionTable; itemLabel: string }) {
  const router = useRouter();
  const [values, setValues] = useState<FieldValueUsage[] | null>(null);
  const [clusters, setClusters] = useState<FieldValueCluster[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [keep, setKeep] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, startTransition] = useTransition();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getFieldValueUsage(table);
      if (cancelled) return;
      if (res.error) return setError(res.error);
      setValues(res.values ?? []);
      setClusters(res.clusters ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [table, reloadKey]);

  function toggle(v: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
    setDone("");
  }

  function selectCluster(c: FieldValueCluster) {
    setPicked(new Set(c.values.map((v) => v.value)));
    // The survivor is the label kept from here on, so it should be the
    // tidy one -- a configured option first, then whichever spelling the
    // most leads already use.
    //
    // Not the one carrying the most money, which was the first guess and
    // is wrong: on this data that picked "CA PRO GUARANTEED" over "CA Pro
    // Guarantee" purely because a single $250,000 job happened to be
    // typed in caps. The money moves either way; only the label stays.
    const best = [...c.values].sort(
      (a, b) =>
        Number(b.configured) - Number(a.configured) ||
        b.leads - a.leads ||
        b.totalValue - a.totalValue
    )[0];
    setKeep(best.value);
    setDone("");
  }

  function merge() {
    setError("");
    setDone("");
    startTransition(async () => {
      const res = await mergeFieldValues(table, [...picked], keep);
      if (res.error) return setError(res.error);
      setDone(`Moved ${res.moved} lead${res.moved === 1 ? "" : "s"} onto “${keep}”.`);
      setPicked(new Set());
      setKeep("");
      setReloadKey((k) => k + 1);
      router.refresh();
    });
  }

  if (!values) return null;

  const chosen = values.filter((v) => picked.has(v.value));
  const movingCount = chosen.filter((v) => v.value !== keep).reduce((s, v) => s + v.leads, 0);

  return (
    <section className="ta-panel" style={{ marginTop: 18 }}>
      <div className="module-toolbar" style={{ marginBottom: 8 }}>
        <div>
          <strong>Merge duplicates</strong>
          <div className="est-tax-note">
            {values.length} distinct {itemLabel.toLowerCase()} values are on leads right now
            {values.filter((v) => !v.configured).length > 0 &&
              ` — ${values.filter((v) => !v.configured).length} of them are not in the list above`}
          </div>
        </div>
      </div>

      {clusters.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p className="hint-note" style={{ marginTop: 0 }}>
            Same thing, typed differently. Reporting splits across these, so a source can
            look far smaller than it is.
          </p>
          {clusters.map((c) => (
            <div key={c.key} className="est-record" style={{ marginBottom: 8 }}>
              <div className="est-record-title">
                {c.values.map((v) => v.value).join("  ·  ")}
              </div>
              <div className="est-tax-note">
                {c.values.reduce((s, v) => s + v.leads, 0)} leads ·{" "}
                {money(c.values.reduce((s, v) => s + v.totalValue, 0))} across{" "}
                {c.values.length} spellings
              </div>
              <div className="est-pay-actions">
                <button className="btn-ghost small" onClick={() => selectCluster(c)} disabled={pending}>
                  Select these
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th></th>
            <th>Value</th>
            <th className="right">Leads</th>
            <th className="right">Value</th>
          </tr>
        </thead>
        <tbody>
          {values.map((v) => (
            <tr key={v.value}>
              <td>
                <input
                  type="checkbox"
                  checked={picked.has(v.value)}
                  disabled={pending}
                  onChange={() => toggle(v.value)}
                  aria-label={`Select ${v.value}`}
                />
              </td>
              <td>
                {v.value}
                {!v.configured && <span className="est-tax-note"> · not in the list</span>}
              </td>
              <td className="right mono">{v.leads}</td>
              <td className="right mono">{money(v.totalValue)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {picked.size > 0 && (
        <div className="est-record" style={{ marginTop: 12 }}>
          <label className="field">
            <span className="field-label">Keep this spelling</span>
            <select value={keep} onChange={(e) => setKeep(e.target.value)} disabled={pending}>
              <option value="">Choose…</option>
              {chosen.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.value} — {v.leads} leads, {money(v.totalValue)}
                </option>
              ))}
            </select>
          </label>
          {keep && (
            <p className="hint-note">
              {movingCount} lead{movingCount === 1 ? "" : "s"} will move onto “{keep}”. The
              other spellings are removed from the list. Nothing else on those leads changes.
            </p>
          )}
          {error && <p className="error-note">{error}</p>}
          <div className="est-pay-actions">
            <button
              className="btn-primary"
              onClick={merge}
              disabled={pending || !keep || picked.size < 2}
            >
              {pending ? "Merging…" : `Merge ${picked.size} into one`}
            </button>
            <button className="btn-ghost" onClick={() => setPicked(new Set())} disabled={pending}>
              Clear
            </button>
          </div>
        </div>
      )}

      {done && <p className="cp-saved">✓ {done}</p>}
      {error && picked.size === 0 && <p className="error-note">{error}</p>}
    </section>
  );
}
