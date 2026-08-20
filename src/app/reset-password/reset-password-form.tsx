"use client";

import { useActionState } from "react";
import { resetPassword, type AuthFormState } from "@/lib/actions/auth";

export function ResetPasswordForm({ tokenHash }: { tokenHash: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    resetPassword,
    undefined
  );

  if (!tokenHash) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">Reset password</h1>
          <p className="auth-sub">
            This page only works from a reset link. Request one and open the
            email on this device.
          </p>
          <p className="auth-switch">
            <a href="/forgot-password">Request a reset link</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-title">Set a new password</h1>
        <p className="auth-sub">You&apos;ll be signed in right after</p>
        <form action={action} className="auth-form">
          <input type="hidden" name="token_hash" value={tokenHash} />
          <label className="field">
            <span className="field-label">New password</span>
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
          <button type="submit" className="btn-primary auth-submit" disabled={pending}>
            {pending ? "Saving…" : "Set password & sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
