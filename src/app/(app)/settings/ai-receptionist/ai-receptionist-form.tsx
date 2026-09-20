"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/field";
import { approxRings } from "@/lib/ai-receptionist";
import { saveAiReceptionistSettings } from "@/lib/actions/settings";

export function AiReceptionistForm({
  settings,
  transferNumber,
  configured,
  migrationPending,
  transferPending,
}: {
  settings: {
    ai_receptionist_enabled: boolean;
    ai_receptionist_greeting: string | null;
    call_forward_timeout: number | null;
  };
  transferNumber: string | null;
  configured: boolean;
  migrationPending: boolean;
  transferPending: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(settings.ai_receptionist_enabled);
  const [greeting, setGreeting] = useState(settings.ai_receptionist_greeting ?? "");
  const [timeoutSeconds, setTimeoutSeconds] = useState(settings.call_forward_timeout ?? 25);
  const [transfer, setTransfer] = useState(transferNumber ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setPending(true);
    setError("");
    const result = await saveAiReceptionistSettings({
      enabled,
      greeting,
      timeoutSeconds,
      transferNumber: transfer,
    });
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  const rings = approxRings(timeoutSeconds);

  return (
    <div>
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
      </div>

      <div className="cp-card">
        <div className="cp-card-head">⏱ Pickup &amp; hand-off</div>

        <Field label="Ring your phone for (seconds)">
          <input
            type="number"
            min={5}
            max={60}
            value={timeoutSeconds}
            onChange={(e) => {
              setTimeoutSeconds(Number(e.target.value) || 25);
              setSaved(false);
            }}
          />
        </Field>
        <p className="cp-hint">
          ≈ {rings} ring{rings === 1 ? "" : "s"} before the AI picks up. This is the same
          &ldquo;Ring For&rdquo; setting as on{" "}
          <Link href="/settings/company-profile">Company Profile</Link> — your forwarding phone
          rings this long first, then the AI answers. With no forwarding number set, the AI
          answers right away.
        </p>

        <Field label="Transfer to a person (optional)">
          <input
            type="tel"
            value={transfer}
            onChange={(e) => {
              setTransfer(e.target.value);
              setSaved(false);
            }}
            placeholder="+18183008242"
            disabled={transferPending}
          />
        </Field>
        {transferPending ? (
          <p className="error-note">
            <strong>
              Run <code>supabase/migrations/0161_receptionist_transfer.sql</code> in the Supabase
              SQL editor
            </strong>{" "}
            to unlock this field. It&apos;s safe to run twice; the rest of this page works
            without it.
          </p>
        ) : (
          <p className="cp-hint">
            When set, a caller who asks for a person (or presses 0) gets connected to this number.
            If nobody answers, the AI apologizes and keeps taking their details — the caller is
            never left hanging. Leave blank to turn transfers off.
          </p>
        )}

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
