"use client";

import { useActionState } from "react";
import { login, type AuthFormState } from "@/lib/actions/auth";

/**
 * Sign-in only.
 *
 * This form used to have a "Create account" tab wired to a plain
 * supabase.auth.signUp. It made a login and nothing else: no company, no
 * company_members row, and every page in the app reads permissions from
 * that row -- so the account it produced could sign in and immediately be
 * redirected back here, forever. New businesses now come in through
 * /get-started, which creates the company alongside the account. Staff
 * are still added by an Office/Admin user in Settings -> Users & Roles.
 */
export function LoginForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    login,
    undefined
  );

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-title">Contractor CRM</h1>
        <p className="auth-sub">Sign in to your account</p>

        <form action={action} className="auth-form">
          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" name="email" required autoComplete="email" />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
            />
          </label>
          {state?.error && <p className="error-note">{state.error}</p>}
          <button
            type="submit"
            className="btn-primary auth-submit"
            disabled={pending}
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
          <p className="auth-switch" style={{ marginTop: 8 }}>
            <a href="/forgot-password">Forgot password?</a>
          </p>
        </form>

        <p className="auth-switch">
          New business? <a href="/get-started">Start an account</a>
        </p>
      </div>
    </div>
  );
}
