"use client";

import { useActionState, useState } from "react";
import { completeSignup } from "@/lib/actions/signup";
import type { AuthFormState } from "@/lib/actions/auth";
import { US_STATES, timezoneForState } from "@/lib/data/us-states";
import { TRADES } from "@/lib/trade-starters";
import { TIMEZONE_OPTIONS } from "@/lib/data/types";

export function RegisterForm({
  token,
  companyName,
  email,
}: {
  token: string;
  // Set on a paid signup (carried on the invite from the Get Started
  // form) and null on one an admin sent by hand -- nobody has typed a
  // company name in yet on that path, so this form collects it instead
  // of showing it.
  companyName: string | null;
  email: string;
}) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    completeSignup,
    undefined
  );
  // The company's own state and time zone (DECISIONS #118). Picking a
  // state fills in its usual zone; it can still be changed.
  const [usState, setUsState] = useState("");
  const [timezone, setTimezone] = useState("");

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-title">{companyName || "Set up your account"}</h1>
        <p className="auth-sub">
          {companyName
            ? "Set your password and you're in"
            : "Name your company, set your password, and you're in"}
        </p>
        <form action={action} className="auth-form">
          <input type="hidden" name="token" value={token} />
          <label className="field">
            <span className="field-label">Email</span>
            {/* Fixed: it is the address that paid (or that the invite was
                sent to), and the address this link was sent to. Editable
                would make it a free account for anyone the email gets
                forwarded to. */}
            <input type="email" value={email} readOnly disabled />
          </label>
          {companyName === null && (
            <label className="field">
              <span className="field-label">Company name</span>
              <input type="text" name="company_name" required autoComplete="organization" />
            </label>
          )}
          <label className="field">
            <span className="field-label">Your trade</span>
            <select name="trade" required defaultValue="">
              <option value="" disabled>
                Choose your trade
              </option>
              {TRADES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="hint-note">
              Sets the words and pipeline stages you start with. You can change any of them later.
            </span>
          </label>
          <label className="field">
            <span className="field-label">State your company works in</span>
            <select
              name="state"
              required
              value={usState}
              onChange={(e) => {
                setUsState(e.target.value);
                setTimezone(timezoneForState(e.target.value) ?? timezone);
              }}
            >
              <option value="" disabled>
                Choose a state
              </option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Time zone</span>
            <select name="timezone" required value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              <option value="" disabled>
                Choose a time zone
              </option>
              {TIMEZONE_OPTIONS.map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Your name</span>
            <input type="text" name="name" required autoComplete="name" />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <label className="field">
            <span className="field-label">Repeat it</span>
            <input
              type="password"
              name="confirm"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          {state?.error && <p className="error-note">{state.error}</p>}
          {state?.info && (
            <p className="hint-note" style={{ color: "var(--success)" }}>
              {state.info}
            </p>
          )}
          <button type="submit" className="btn-primary auth-submit" disabled={pending}>
            {pending ? "Setting up…" : "Create my CRM"}
          </button>
          <p className="auth-switch" style={{ marginTop: 8 }}>
            <a href="/login">Sign in instead</a>
          </p>
        </form>
      </div>
      <footer className="site-footer">
        © 2026 AI Build Pros LLC. All rights reserved.
      </footer>
    </div>
  );
}
