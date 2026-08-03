"use client";

import { useState } from "react";
import { requestPortalLink } from "@/lib/actions/portal";

export function PortalLoginForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await requestPortalLink(email);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSent(true);
    } catch {
      // Without this the button sticks on "Sending…" forever whenever the
      // action throws, leaving the visitor with no idea what happened.
      setError("Something went wrong sending that link. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="portal-auth-wrap">
      <div className="portal-auth-card">
        <h1 className="portal-auth-title">Your Project Portal</h1>

        {sent ? (
          <>
            <p className="portal-auth-sub">
              If <strong>{email}</strong> matches a project with us, a sign-in link is on its way.
              It works once and expires in 30 minutes.
            </p>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setSent(false);
                setEmail("");
              }}
            >
              Use a different email
            </button>
          </>
        ) : (
          <>
            <p className="portal-auth-sub">
              Enter the email address your contractor has on file and we&apos;ll send you a
              sign-in link — no password needed.
            </p>
            <form onSubmit={handleSubmit}>
              <label className="portal-auth-label" htmlFor="portal-email">
                Email address
              </label>
              <input
                id="portal-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
              {error && <p className="error-note">{error}</p>}
              <button type="submit" className="btn-primary portal-auth-submit" disabled={pending}>
                {pending ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
