"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import { FilePreview } from "@/components/ui/file-preview";
import {
  getJobWhatsApp,
  linkWhatsAppGroup,
  listWhatsAppGroupChoices,
  unlinkWhatsAppGroup,
  type JobWhatsApp as JobWhatsAppData,
  type JobWhatsAppMessage,
} from "@/lib/actions/whatsapp-groups";

type GroupChoice = { id: string; name: string; linkedTo: string | null };

const WHEN: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

/**
 * ONE job's WhatsApp groups (DECISIONS #193): what was said in them,
 * oldest at the top like a chat, with each photo copied into the job's
 * Photos and shown here too. Office/Admin/Production link a group the
 * project bot number is in; everyone who can see the job reads it.
 */
export function JobWhatsApp({
  estimateId,
  jobLabel,
  onClose,
}: {
  estimateId: string;
  jobLabel: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<JobWhatsAppData | null>(null);
  const [choices, setChoices] = useState<GroupChoice[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function reload() {
    const res = await getJobWhatsApp(estimateId);
    if (res.error) setError(res.error);
    setData(res);
  }

  useEffect(() => {
    let cancelled = false;
    getJobWhatsApp(estimateId).then((res) => {
      if (cancelled) return;
      if (res.error) setError(res.error);
      setData(res);
    });
    return () => {
      cancelled = true;
    };
  }, [estimateId]);

  async function showOlder() {
    if (!data?.messages.length) return;
    setBusy("Loading older messages…");
    const res = await getJobWhatsApp(estimateId, data.messages[0].sentAt);
    setBusy("");
    if (res.error) return setError(res.error);
    setData({ ...data, messages: [...res.messages, ...data.messages], hasMore: res.hasMore });
  }

  async function openPicker() {
    setError("");
    setNote("");
    setBusy("Loading the bot number's groups…");
    const res = await listWhatsAppGroupChoices(estimateId);
    setBusy("");
    if (res.error) return setError(res.error);
    setChoices(res.options ?? []);
    setPick(res.options?.[0]?.id ?? "");
  }

  async function link() {
    const choice = choices?.find((c) => c.id === pick);
    if (!choice) return;
    if (choice.linkedTo && !confirm(`"${choice.name}" is on ${choice.linkedTo}. Move it to this job?`)) return;
    setError("");
    setBusy("Linking…");
    const res = await linkWhatsAppGroup(estimateId, choice.id);
    setBusy("");
    if (res.error) return setError(res.error);
    setChoices(null);
    setNote(
      `Linked "${choice.name}". Its last 100 messages and their photos are coming in now — close and reopen in a minute to see them all.`
    );
    await reload();
  }

  async function unlink(group: { id: string; name: string }) {
    if (!confirm(`Take "${group.name}" off this job? What was already saved stays in the job's files.`)) return;
    setError("");
    setNote("");
    setBusy("Unlinking…");
    const res = await unlinkWhatsAppGroup(estimateId, group.id);
    setBusy("");
    if (res.error) return setError(res.error);
    await reload();
  }

  return (
    <Modal title={`WhatsApp — ${jobLabel}`} onClose={() => { if (!busy) onClose(); }} wide>
      {data === null ? (
        <p className="empty-hint">Loading…</p>
      ) : data.migrationMissing ? (
        <p className="error-note">
          One database step is left: run supabase/migrations/0228_whatsapp_groups.sql in the Supabase SQL editor.
        </p>
      ) : (
        <>
          <div className="wa-groups">
            {data.groups.length === 0 ? (
              <p className="empty-hint">No WhatsApp group on this job yet.</p>
            ) : (
              data.groups.map((g) => (
                <span key={g.id} className="wa-group">
                  💬 {g.name}
                  {data.canLink && (
                    <button
                      type="button"
                      className="btn-ghost small"
                      disabled={!!busy}
                      onClick={() => void unlink(g)}
                    >
                      Unlink
                    </button>
                  )}
                </span>
              ))
            )}
          </div>

          {!data.connected && data.groups.length === 0 && (
            <p className="hint-note">
              No project bot number is connected yet. An Office or Admin user connects one in{" "}
              <Link href="/settings/whatsapp-groups">Settings › WhatsApp Groups</Link>.
            </p>
          )}

          {data.connected && data.canLink && (
            <div className="wa-link-row">
              {choices === null ? (
                <button type="button" className="btn-ghost small" disabled={!!busy} onClick={() => void openPicker()}>
                  + Link a group
                </button>
              ) : choices.length === 0 ? (
                <p className="hint-note">
                  The project bot number isn&apos;t in any other group. Add it to the project&apos;s WhatsApp group
                  first.
                </p>
              ) : (
                <>
                  <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="WhatsApp group">
                    {choices.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.linkedTo ? ` (on ${c.linkedTo})` : ""}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn-primary small" disabled={!!busy || !pick} onClick={() => void link()}>
                    Link
                  </button>
                  <button type="button" className="btn-ghost small" disabled={!!busy} onClick={() => setChoices(null)}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          )}

          {busy && <p className="hint-note">{busy}</p>}
          {error && <p className="error-note">{error}</p>}
          {note && !error && <p className="hint-note">{note}</p>}

          {data.groups.length > 0 &&
            (data.messages.length === 0 ? (
              <p className="empty-hint">Nothing has been said in this job&apos;s group since the bot number joined.</p>
            ) : (
              <div className="wa-thread">
                {data.hasMore && (
                  <button type="button" className="btn-ghost small" disabled={!!busy} onClick={() => void showOlder()}>
                    Show older messages
                  </button>
                )}
                {data.messages.map((m) => (
                  <Message key={m.id} m={m} />
                ))}
              </div>
            ))}
        </>
      )}
    </Modal>
  );
}

function Message({ m }: { m: JobWhatsAppMessage }) {
  return (
    <div className={`wa-msg wa-msg-${m.who}`}>
      <div className="wa-msg-head">
        <strong>{m.sender}</strong>
        <span className="wa-msg-when">{new Date(m.sentAt).toLocaleString("en-US", WHEN)}</span>
      </div>
      {m.media && <Media media={m.media} kind={m.kind} />}
      {m.body && <p className="wa-msg-body">{m.body}</p>}
    </div>
  );
}

function Media({ media, kind }: { media: NonNullable<JobWhatsAppMessage["media"]>; kind: JobWhatsAppMessage["kind"] }) {
  const what = kind === "image" ? "photo" : kind === "video" ? "video" : kind === "audio" ? "voice note" : "file";
  if (media.file) {
    const file = {
      url: media.file.url,
      name: media.file.name,
      contentType: media.file.contentType,
      driveId: media.file.driveId,
    };
    return kind === "image" ? (
      <div className="wa-msg-photo">
        <FilePreview block file={file}>
          {/* eslint-disable-next-line @next/next/no-img-element -- stored
              files, sizes unknown at build time */}
          <img src={media.file.thumbUrl} alt={media.file.name} loading="lazy" referrerPolicy="no-referrer" />
        </FilePreview>
      </div>
    ) : (
      <p className="wa-msg-file">
        <FilePreview file={file}>
          {kind === "video" ? "🎬" : kind === "audio" ? "🎙" : "📎"} {media.file.name}
        </FilePreview>
      </p>
    );
  }
  const status =
    media.status === "pending" || media.status === "saving"
      ? `⏳ Copying this ${what} into the job…`
      : media.status === "too_large"
        ? `This ${what} is too big to copy (over 50 MB) — it's still in WhatsApp.`
        : media.status === "saved"
          ? `This ${what} was removed from the job's files.`
          : `Couldn't copy this ${what} — it's still in WhatsApp.`;
  return <p className="wa-msg-file est-tax-note">{status}</p>;
}
