"use client";

import { useActionState } from "react";
import { completeSignup } from "@/lib/actions/signup";
import type { AuthFormState } from "@/lib/actions/auth";

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
