"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/field";
import { saveAiReceptionistSettings } from "@/lib/actions/settings";

export function AiReceptionistForm({
  settings,
  configured,
  migrationPending,
}: {
  settings: {
    ai_receptionist_enabled: boolean;
    ai_receptionist_greeting: string | null;
  };
  configured: boolean;
  migrationPending: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(settings.ai_receptionist_enabled);
  const [greeting, setGreeting] = useState(settings.ai_receptionist_greeting ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setPending(true);
    setError("");
    const result = await saveAiReceptionistSettings({ enabled, greeting });
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <div className="ur-breadcrumb">
        <Link href="/settings" className="ur-crumb-link">
          ⚙ Settings
        </Link>
        <span> › </span>
        <span>AI Receptionist</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h1 className="module-title">AI Receptionist</h1>
          <p className="module-sub">
            When a call would hit voicemail — no forwarding number, or nobody picked up — the AI
            answers instead: it takes the caller&apos;s name, project and address, files the lead
            with the full transcript, and texts them a confirmation
          </p>
        </div>
      </div>

      {migrationPending && (
        <p className="error-note">
          <strong>
            Run <code>supabase/migrations/0160_ai_receptionist.sql</code> in the Supabase SQL
            editor first
          </strong>{" "}
          — until then the receptionist can&apos;t store its calls, and this switch won&apos;t
          save. It&apos;s safe to run twice.
        </p>
      )}
      {!configured && (
        <p className="error-note">
          The AI service isn&apos;t connected on the server yet — the setting will save, but calls
          keep today&apos;s voicemail behavior until it is.
        </p>
      )}

      <div className="cp-card">
        <div className="cp-card-head">📞 Answering</div>

        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setSaved(false);
            }}
          />
          <span>Answer missed calls with the AI receptionist</span>
        </label>
        <p className="cp-hint">
          It always introduces itself as an AI assistant, never quotes a price, and never promises
          a firm appointment — it collects details and says the team will call back. Your{" "}
          <Link href="/settings/call-scripts">call script</Link> is used as its background
          knowledge about the company.
        </p>

        <Field label="Opening line (optional)">
          <textarea
            value={greeting}
            onChange={(e) => {
              setGreeting(e.target.value);
              setSaved(false);
            }}
            rows={3}
            placeholder="I can take your details and have someone call you right back. How can I help?"
          />
        </Field>
        <p className="cp-hint">
          Spoken right after the fixed first sentence (&ldquo;Thanks for calling … I&apos;m the
          company&apos;s AI assistant, and this call may be transcribed.&rdquo;). Leave blank for
          the default shown above.
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <button className="btn-primary" onClick={save} disabled={pending || migrationPending}>
            {pending ? "Saving…" : "Save"}
          </button>
          {saved && <span className="cp-hint">Saved.</span>}
          {error && <span className="error-note">{error}</span>}
        </div>
      </div>
    </div>
  );
}
