"use client";

import { useActionState } from "react";
import { completeSignup, type SignupFormState } from "@/lib/actions/signup";

export function RegisterForm({
  token,
  companyName,
  email,
}: {
  token: string;
  companyName: string;
  email: string;
}) {
  const [state, action, pending] = useActionState<SignupFormState, FormData>(
    completeSignup,
    undefined
  );

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-title">{companyName}</h1>
        <p className="auth-sub">Set your password and you&apos;re in</p>
        <form action={action} className="auth-form">
          <input type="hidden" name="token" value={token} />
          <label className="field">
            <span className="field-label">Email</span>
            {/* Fixed: it is the address that paid, and the address this
                link was sent to. Editable would make it a free account
                for anyone the email gets forwarded to. */}
            <input type="email" value={email} readOnly disabled />
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
    </div>
  );
}
