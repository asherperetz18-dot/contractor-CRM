"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  addGeneralGroup,
  listGeneralGroups,
  removeGeneralGroup,
  type GeneralGroups as GeneralGroupsData,
} from "@/lib/actions/whatsapp-inbox";

/**
 * A company's general WhatsApp groups (DECISIONS #204): groups that are
 * no single job -- receipts, supply runs, odd photos. What they post
 * waits in the WhatsApp Inbox to be filed to a job or made into a bill.
 */
export function GeneralGroups() {
  const [data, setData] = useState<GeneralGroupsData | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function reload() {
    const res = await listGeneralGroups();
    setData(res);
    setPick(res.choices[0]?.id ?? "");
  }

  useEffect(() => {
    let cancelled = false;
    listGeneralGroups().then((res) => {
      if (cancelled) return;
      setData(res);
      setPick(res.choices[0]?.id ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function add() {
    const choice = data?.choices.find((c) => c.id === pick);
    if (!choice) return;
    if (choice.linkedTo && !confirm(`"${choice.name}" is on ${choice.linkedTo}. Make it a general group instead?`)) {
      return;
    }
    setError("");
    setNote("");
    setBusy("Adding…");
    const res = await addGeneralGroup(choice.id);
    setBusy("");
    if (res.error) return setError(res.error);
    setNote(`Added "${choice.name}". Its last 100 messages and their files are coming into the WhatsApp Inbox now.`);
    await reload();
  }

  async function remove(group: { id: string; name: string }) {
    if (!confirm(`Stop sending "${group.name}" to the WhatsApp Inbox? What's already there stays.`)) return;
    setError("");
    setNote("");
    setBusy("Removing…");
    const res = await removeGeneralGroup(group.id);
    setBusy("");
    if (res.error) return setError(res.error);
    await reload();
  }

  if (data === null) return null;

  return (
    <div className="wa-general">
      <h3>General groups</h3>
      {data.migrationMissing ? (
        <p className="error-note">
          One database step is left: run supabase/migrations/0230_whatsapp_inbox.sql in the Supabase SQL editor.
        </p>
      ) : (
        <>
          <p className="module-sub" style={{ margin: 0 }}>
            For a group that isn&apos;t one job — receipts, supply runs, odd photos. Everything posted there waits in
            the <Link href="/whatsapp-inbox">WhatsApp Inbox</Link> to be filed to a job or made into a bill. Never
            shown to clients.
          </p>
          {data.groups.map((g) => (
            <div key={g.id} className="wa-group-row">
              <span className="wa-group">💬 {g.name}</span>
              <span className="wa-group-who">{g.toSort} to sort</span>
              <span className="wa-group-actions">
                <button type="button" className="btn-ghost small" disabled={!!busy} onClick={() => void remove(g)}>
                  Remove
                </button>
              </span>
            </div>
          ))}
          {data.choices.length > 0 ? (
            <div className="wa-add-row">
              <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="WhatsApp group">
                {data.choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.linkedTo ? ` (on ${c.linkedTo})` : ""}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-primary small" disabled={!!busy || !pick} onClick={() => void add()}>
                + Add as general group
              </button>
            </div>
          ) : (
            <p className="hint-note">Add the project bot number to the general WhatsApp group first.</p>
          )}
        </>
      )}
      {busy && <p className="hint-note">{busy}</p>}
      {(error || data.error) && <p className="error-note">{error || data.error}</p>}
      {note && !error && <p className="hint-note">{note}</p>}
    </div>
  );
}
