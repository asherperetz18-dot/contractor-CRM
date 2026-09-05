"use client";

import { useState } from "react";
import { startSignupCheckout } from "@/lib/actions/signup";

export function GetStartedForm() {
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await startSignupCheckout({ companyName, email });
      if (result.url) {
        // Stripe hosts the payment page; card details never touch this app.
        window.location.href = result.url;
        return;
      }
      setError(result.error ?? "Couldn't start checkout.");
    } catch {
      // A server action can reject outright -- a dropped connection, a 500
      // from the action endpoint. Without this the button stays disabled
      // reading "Opening checkout…" for good, with nothing on screen
      // saying why.
      setError("Couldn't reach the server. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-title">Contractor CRM</h1>
        <p className="auth-sub">Start your account</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field">
            <span className="field-label">Company name</span>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              autoComplete="organization"
            />
          </label>
          <label className="field">
            <span className="field-label">Work email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <p className="hint-note">
            We&apos;ll email your setup link here after payment, so use an inbox you can open.
          </p>
          {error && <p className="error-note">{error}</p>}
          <button type="submit" className="btn-primary auth-submit" disabled={pending}>
            {pending ? "Opening checkout…" : "Continue to payment"}
          </button>
          <p className="auth-switch" style={{ marginTop: 8 }}>
            Already have an account? <a href="/login">Sign in</a>
          </p>
        </form>
      </div>
    </div>
  );
}
