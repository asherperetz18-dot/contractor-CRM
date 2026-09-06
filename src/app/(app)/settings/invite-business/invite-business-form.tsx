"use client";

import { useState } from "react";
import Link from "next/link";
import { Field } from "@/components/ui/field";
import { sendManualSignupInvite } from "@/lib/actions/admin-invite";

/**
 * The manual door: send a setup link to any address, no payment involved.
 * Same /register page and completeSignup() as a paid signup runs through
 * -- this just skips Stripe and starts the invite with no company name,
 * which the person redeeming it types in for themselves.
 */
export function InviteBusinessForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function send() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setPending(true);
    setError("");
    const result = await sendManualSignupInvite(trimmed);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setSentTo(trimmed);
    setEmail("");
  }

  return (
    <div>
      <div className="ur-breadcrumb">
        <Link href="/settings" className="ur-crumb-link">
          ⚙ Settings
        </Link>
        <span> › </span>
        <span>Invite a Business</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Invite a Business</h1>
          <p className="module-sub">
            Send a setup link straight to an email address — no payment involved.
            They pick their own company name, password, and starter lists when
            they open it.
          </p>
        </div>
      </div>

      <div className="cp-card">
        <div className="cp-card-head">✉️ Send a setup link</div>
        <p className="cp-card-sub">
          The link works once and expires in 7 days, same as a paid signup&apos;s.
        </p>

        <Field label="Email address">
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSentTo(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
            placeholder="owner@theirbusiness.com"
            disabled={pending}
          />
        </Field>

        {error && <p className="error-note">{error}</p>}
        {sentTo && (
          <p className="hint-note" style={{ color: "var(--success)" }}>
            ✓ Sent to {sentTo}
          </p>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={send}
            disabled={pending || !email.trim()}
          >
            {pending ? "Sending…" : "Send invite"}
          </button>
        </div>
      </div>
    </div>
  );
}
