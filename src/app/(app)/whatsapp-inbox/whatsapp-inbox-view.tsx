"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FilePreview } from "@/components/ui/file-preview";
import { AddBillModal, jobOptionsFromProjects } from "@/components/bills/add-bill-modal";
import {
  dismissInboxItem,
  fileInboxItem,
  getWhatsAppInbox,
  markInboxItemBilled,
  restoreInboxItem,
  type InboxData,
  type InboxItem,
} from "@/lib/actions/whatsapp-inbox";

type View = "to_sort" | "filed" | "dismissed";

const VIEWS: { key: View; label: string }[] = [
  { key: "to_sort", label: "To sort" },
  { key: "filed", label: "Filed" },
  { key: "dismissed", label: "Dismissed" },
];

const WHEN: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

/**
 * The WhatsApp Inbox (DECISIONS #204): each photo or file from a general
 * group as a card, newest first, with what to do with it -- make it a
 * bill (the normal bill window, receipt attached), file it to a job, or
 * dismiss it. A caption naming a job's street, customer or number
 * suggests that job for one-click filing.
 */
export function WhatsAppInboxView() {
  const [view, setView] = useState<View>("to_sort");
  const [data, setData] = useState<InboxData | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [pickJob, setPickJob] = useState("");
  const [billFor, setBillFor] = useState<InboxItem | null>(null);

  async function load(next: View) {
    const res = await getWhatsAppInbox(next);
    setError(res.error ?? "");
    setData(res);
  }

  useEffect(() => {
    let cancelled = false;
    getWhatsAppInbox(view).then((res) => {
      if (cancelled) return;
      setError(res.error ?? "");
      setData(res);
    });
    return () => {
      cancelled = true;
    };
  }, [view]);

  const jobsByLabel = useMemo(
    () => [...(data?.jobs ?? [])].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    [data]
  );
  const billJobs = useMemo(
    () =>
      jobOptionsFromProjects(
        (data?.jobs ?? []).map((j) => ({ leadId: j.leadId, customer: j.customer, address: j.address, status: "active" }))
      ),
    [data]
  );

  async function act(label: string, run: () => Promise<{ error?: string }>, done: string) {
    setError("");
    setNote("");
    setBusy(label);
    const res = await run();
    setBusy("");
    if (res.error) return setError(res.error);
    setNote(done);
    setPickFor(null);
    await load(view);
  }

  async function showOlder() {
    if (!data?.items.length) return;
    setBusy("Loading older items…");
    const res = await getWhatsAppInbox(view, data.items[data.items.length - 1].sentAt);
    setBusy("");
    if (res.error) return setError(res.error);
    setData({ ...data, items: [...data.items, ...res.items], hasMore: res.hasMore });
  }

  if (data === null) return <p className="empty-hint">Loading…</p>;
  if (data.migrationMissing) {
    return (
      <p className="error-note">
        One database step is left: run supabase/migrations/0230_whatsapp_inbox.sql in the Supabase SQL editor, then
        reload this page.
      </p>
    );
  }
  if (!data.groups.length) {
    return (
      <div className="empty-state">
        <p className="empty-label">No general group yet</p>
        <p className="empty-hint">
          Add the company&apos;s receipts or general WhatsApp group in{" "}
          <Link href="/settings/whatsapp-groups">Settings › WhatsApp Groups</Link> (Office or Admin). Its photos and
          files then wait here to be sorted.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="wai-tools">
        <div className="chip-row">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              className={`chip${view === v.key ? " chip-active" : ""}`}
              onClick={() => {
                setNote("");
                setPickFor(null);
                setView(v.key);
              }}
            >
              {v.label} {data.counts[v.key]}
            </button>
          ))}
        </div>
        <span className="est-tax-note">From {data.groups.map((g) => g.name).join(", ")}</span>
      </div>

      {busy && <p className="hint-note">{busy}</p>}
      {error && <p className="error-note">{error}</p>}
      {note && !error && <p className="hint-note">{note}</p>}

      {data.items.length === 0 ? (
        <p className="empty-hint">
          {view === "to_sort" ? "Nothing to sort — every photo and file is filed." : "Nothing here yet."}
        </p>
      ) : (
        <div className="wai-grid">
          {data.items.map((item) => (
            <div key={item.id} className="wai-card">
              <Media item={item} />
              <div className="wai-head">
                <strong>{item.sender}</strong>
                <span className="wai-when">
                  {new Date(item.sentAt).toLocaleString("en-US", WHEN)} · {item.groupName}
                </span>
              </div>
              {item.body && <p className="wai-caption">{item.body}</p>}

              {item.outcome && <p className="est-tax-note" style={{ margin: 0 }}>{item.outcome}</p>}

              {view === "to_sort" && item.file && item.suggestion && (
                <div className="wai-suggest">
                  <span>
                    Looks like <strong>{item.suggestion.label}</strong> (caption says “{item.suggestion.because}”)
                  </span>
                  <button
                    type="button"
                    className="btn-ghost small"
                    disabled={!!busy}
                    onClick={() =>
                      void act(
                        "Filing…",
                        () => fileInboxItem(item.id, item.suggestion!.estimateId),
                        `Filed to ${item.suggestion!.label}.`
                      )
                    }
                  >
                    File there
                  </button>
                </div>
              )}

              {view === "to_sort" && item.file && (
                <div className="wai-actions">
                  {data.canMakeBill && (
                    <button type="button" className="btn-ghost small" disabled={!!busy} onClick={() => setBillFor(item)}>
                      🧾 Make a bill…
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-ghost small"
                    disabled={!!busy}
                    onClick={() => {
                      setPickFor(item.id);
                      setPickJob(item.suggestion?.estimateId ?? "");
                    }}
                  >
                    📷 File to a job…
                  </button>
                  <button
                    type="button"
                    className="btn-ghost small"
                    disabled={!!busy}
                    onClick={() => void act("Dismissing…", () => dismissInboxItem(item.id), "Dismissed.")}
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {pickFor === item.id && (
                <div className="wai-pick">
                  <select value={pickJob} onChange={(e) => setPickJob(e.target.value)} aria-label="Job">
                    <option value="">Pick the job…</option>
                    {jobsByLabel.map((j) => (
                      <option key={j.estimateId} value={j.estimateId}>
                        {j.label}
                        {j.address ? ` · ${j.address.split(",")[0]}` : ""}
                      </option>
                    ))}
                  </select>
                  <div className="wai-actions">
                    <button
                      type="button"
                      className="btn-primary small"
                      disabled={!!busy || !pickJob}
                      onClick={() =>
                        void act(
                          "Filing…",
                          () => fileInboxItem(item.id, pickJob),
                          `Filed to ${jobsByLabel.find((j) => j.estimateId === pickJob)?.label ?? "the job"}.`
                        )
                      }
                    >
                      File
                    </button>
                    <button type="button" className="btn-ghost small" disabled={!!busy} onClick={() => setPickFor(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {view === "dismissed" && (
                <div className="wai-actions">
                  <button
                    type="button"
                    className="btn-ghost small"
                    disabled={!!busy}
                    onClick={() => void act("Putting it back…", () => restoreInboxItem(item.id), "Back in To sort.")}
                  >
                    Put back
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {data.hasMore && (
        <button type="button" className="btn-ghost small" style={{ marginTop: 12 }} disabled={!!busy} onClick={() => void showOlder()}>
          Show older
        </button>
      )}

      {view === "to_sort" && data.texts.length > 0 && (
        <details className="wai-texts">
          <summary>Messages without a photo ({data.texts.length}) — for reading only</summary>
          <div className="wa-thread" style={{ marginTop: 8 }}>
            {data.texts.map((t) => (
              <div key={t.id} className={`wa-msg wa-msg-${t.who}`}>
                <div className="wa-msg-head">
                  <strong>{t.sender}</strong>
                  <span className="wa-msg-when">{new Date(t.sentAt).toLocaleString("en-US", WHEN)}</span>
                </div>
                <p className="wa-msg-body">{t.body}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      {billFor?.file && (
        <AddBillModal
          jobs={billJobs}
          initialLeadId={billFor.suggestion?.leadId}
          initialEstimateId={billFor.suggestion?.estimateId}
          canBills={data.canBills}
          allowNoJob={data.canBills}
          defaultPaid
          fromInbox={{
            messageId: billFor.id,
            fileName: billFor.file.name,
            contentType: billFor.file.contentType,
            previewUrl: billFor.file.url,
          }}
          onSaved={() => {
            const id = billFor.id;
            void markInboxItemBilled(id).then(() => load(view));
            setNote("Saved the bill and took the receipt out of To sort.");
          }}
          onClose={() => setBillFor(null)}
        />
      )}
    </>
  );
}

function Media({ item }: { item: InboxItem }) {
  if (item.file) {
    const isImage = (item.file.contentType ?? "").startsWith("image/");
    return (
      <FilePreview block file={{ url: item.file.url, name: item.file.name, contentType: item.file.contentType }}>
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- a stored inbox file
          <img className="wai-thumb" src={item.file.url} alt={item.file.name} loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="wai-file">📎 {item.file.name}</span>
        )}
      </FilePreview>
    );
  }
  const status =
    item.mediaStatus === "too_large"
      ? "Too big to copy (over 50 MB) — it's still in WhatsApp."
      : item.mediaStatus === "failed"
        ? "Couldn't copy this file — it's still in WhatsApp."
        : "⏳ Copying from WhatsApp…";
  return <span className="wai-file">{status}</span>;
}
