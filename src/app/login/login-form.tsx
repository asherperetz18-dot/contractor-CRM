"use client";

import { useActionState, useState } from "react";
import { login, signup, type AuthFormState } from "@/lib/actions/auth";

export function LoginForm() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loginState, loginAction, loginPending] = useActionState<
    AuthFormState,
    FormData
  >(login, undefined);
  const [signupState, signupAction, signupPending] = useActionState<
    AuthFormState,
    FormData
  >(signup, undefined);

  const state = mode === "login" ? loginState : signupState;

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-title">Contractor CRM</h1>
        <p className="auth-sub">
          {mode === "login" ? "Sign in to your account" : "Create an account"}
        </p>

        {mode === "login" ? (
          <form action={loginAction} className="auth-form">
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
              disabled={loginPending}
            >
              {loginPending ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <form action={signupAction} className="auth-form">
            <label className="field">
              <span className="field-label">Name</span>
              <input type="text" name="name" required autoComplete="name" />
            </label>
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
                minLength={6}
                autoComplete="new-password"
              />
            </label>
            {state?.error && <p className="error-note">{state.error}</p>}
            {state?.info && (
              <p className="hint-note" style={{ color: "var(--success)" }}>
                {state.info}
              </p>
            )}
            <button
              type="submit"
              className="btn-primary auth-submit"
              disabled={signupPending}
            >
              {signupPending ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}

        <p className="auth-switch">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <a
                onClick={() => setMode("signup")}
                role="button"
                style={{ cursor: "pointer" }}
              >
                Sign up
              </a>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <a
                onClick={() => setMode("login")}
                role="button"
                style={{ cursor: "pointer" }}
              >
                Sign in
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
