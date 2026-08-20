"use client";

import { useActionState } from "react";
import { requestPasswordReset, type AuthFormState } from "@/lib/actions/auth";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    requestPasswordReset,
    undefined
  );

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-title">Reset password</h1>
        <p className="auth-sub">
          Enter your email and we&apos;ll send a link to set a new one
        </p>
        <form action={action} className="auth-form">
          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" name="email" required autoComplete="email" />
          </label>
          {state?.error && <p className="error-note">{state.error}</p>}
          {state?.info && (
            <p className="hint-note" style={{ color: "var(--success)" }}>{state.info}</p>
          )}
          <button type="submit" className="btn-primary auth-submit" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </button>
        </form>
        <p className="auth-switch">
          <a href="/login">Back to sign in</a>
        </p>
      </div>
    </div>
  );
}
