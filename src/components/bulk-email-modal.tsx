"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { resolveBulkEmailTargets } from "@/lib/bulk-email";
import { sendBulkEmail, type BulkEmailResult } from "@/lib/actions/bulk-email";

export function BulkEmailModal({
  leads,
  onClose,
  onSent,
}: {
  leads: { id: string; name: string; email: string | null }[];
  onClose: () => void;
  onSent?: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<BulkEmailResult | null>(null);

  const { targets, skipped } = useMemo(() => resolveBulkEmailTargets(leads), [leads]);
  const emailById = useMemo(() => new Map(leads.map((l) => [l.id, l.email])), [leads]);
  const nameById = useMemo(() => new Map(leads.map((l) => [l.id, l.name])), [leads]);

  async function handleSend() {
    setPending(true);
    setResult(null);
    const res = await sendBulkEmail(
      leads.map((l) => l.id),
      subject,
      message
    );
    setPending(false);
    setResult(res);
    if (!res.error && res.failed.length === 0) {
      onSent?.();
    }
  }

  return (
    <Modal title="Email Selected Contacts" onClose={onClose}>
      <p className="hint-note">
        Sending to {targets.length} contact{targets.length === 1 ? "" : "s"}
        {skipped > 0
          ? ` — ${skipped} selected contact${skipped === 1 ? "" : "s"} have no email on file and will be skipped.`
          : "."}
      </p>

      <Field label="Subject">
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          disabled={pending}
        />
      </Field>

      <Field label="Message">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Write your message..."
          rows={8}
          disabled={pending}
        />
      </Field>

      {result?.error && <p className="error-note">{result.error}</p>}

      {result && !result.error && (
        <p className={result.failed.length > 0 ? "error-note" : "cp-saved"}>
          Sent to {result.sent.length} of {result.sent.length + result.failed.length}
          {result.failed.length > 0 && (
            <>
              {" "}
              — {result.failed.length} failed:{" "}
              {result.failed
                .map((f) => `${emailById.get(f.id) || nameById.get(f.id) || f.id} (${f.error})`)
                .join(", ")}
            </>
          )}
        </p>
      )}

      <div className="modal-actions">
        <button type="button" className="btn-ghost" onClick={onClose}>
          {result && !result.error && result.failed.length === 0 ? "Done" : "Cancel"}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={handleSend}
          disabled={pending || targets.length === 0 || !subject.trim() || !message.trim()}
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
    </Modal>
  );
}
